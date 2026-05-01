import Foundation
import Observation

/// Observable facade around the Daily Briefing API.
///
/// Endpoints (mounted at `/brett` — see `apps/api/src/app.ts`):
/// - `GET /brett/briefing` → returns today's cached briefing or `{ briefing: null }`
/// - `POST /brett/briefing/generate` → streams SSE tokens; we swallow the stream
///   and then re-fetch via `GET /brett/briefing` once the server has finalised
///   the persisted message. The streaming consumer path is desktop-only today;
///   iOS is happy with the simpler "kick off regenerate, then pull" pattern.
///
/// "Dismissed today" is tracked in `UserDefaults` per-day so closing the app
/// doesn't bring it back, but tomorrow's briefing will reappear.
@MainActor
@Observable
final class BriefingStore: Clearable {
    /// Raw Markdown content from the server. `nil` when no briefing exists yet
    /// for today.
    private(set) var briefing: String?

    /// Timestamp of the underlying assistant message. Useful if the UI wants
    /// to show "generated 12 minutes ago" style copy.
    private(set) var generatedAt: Date?

    private(set) var isGenerating: Bool = false

    /// Last error message from fetch/regenerate — surfaced to the card so the
    /// user gets something better than a silent empty state.
    private(set) var lastError: String?

    /// Computed every access so the "dismissed today" bit rolls over the
    /// moment the local date changes — otherwise a briefing dismissed yesterday
    /// stayed hidden after midnight because the stored key was frozen at init.
    /// Scoped per-user so two accounts on the same device don't share state.
    private var defaultsKey: String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return UserScopedStorage.key("briefing.dismissed.\(formatter.string(from: Date()))")
    }

    /// Whether the user has dismissed today's briefing. Backed by
    /// `UserDefaults` so dismissal persists across app launches.
    var isDismissedToday: Bool {
        get { UserDefaults.standard.bool(forKey: defaultsKey) }
        set { UserDefaults.standard.set(newValue, forKey: defaultsKey) }
    }

    private let api: APIClient

    init(api: APIClient = APIClient.shared) {
        self.api = api
        ClearableStoreRegistry.register(self)
    }

    // MARK: - Clearable

    func clearForSignOut() {
        briefing = nil
        generatedAt = nil
        lastError = nil
        isGenerating = false
    }

    #if DEBUG
    /// Test-only: populate in-memory state without touching the network.
    func injectForTesting(briefing: String?, error: String? = nil) {
        self.briefing = briefing
        self.generatedAt = briefing != nil ? Date() : nil
        self.lastError = error
    }
    #endif

    // MARK: - Public API

    /// Fetch today's cached briefing. Safe to call repeatedly — the server
    /// returns whatever was last persisted; there's no autogeneration trigger.
    ///
    /// Failure mode: if the request errors out we DO NOT replace an existing
    /// cached briefing with an error message — the user pulled to refresh
    /// the inbox and ended up with a transient sync error overwriting their
    /// briefing. A quiet retry on the next fetch is better than a loud
    /// "something went wrong" replacing real content.
    func fetch() async {
        do {
            let response: BriefingResponse = try await api.request(
                BriefingResponse.self,
                path: "/brett/briefing",
                method: "GET"
            )
            briefing = response.briefing?.content
            generatedAt = response.briefing?.generatedAt
            lastError = nil
        } catch {
            // Only surface the error if there's no cached briefing to keep
            // showing. Even then, only on regenerate (user-initiated) does
            // the card render the error prominently — passive fetches that
            // fail just leave the card in its "no briefing yet" state.
            if briefing == nil {
                #if DEBUG
                print("[BriefingStore] fetch failed with no cache: \(error)")
                #endif
            } else {
                #if DEBUG
                print("[BriefingStore] fetch failed but cache preserved: \(error)")
                #endif
            }
        }
    }

    /// Ask the server to generate a fresh briefing. The generate endpoint is
    /// SSE-streamed on desktop; here we just let the stream run to completion
    /// then re-fetch the final persisted briefing. We read the response as
    /// raw bytes so the decoder doesn't trip on the SSE payload.
    func regenerate() async {
        guard !isGenerating else { return }
        isGenerating = true
        lastError = nil
        defer { isGenerating = false }

        do {
            _ = try await api.rawRequest(
                path: "/brett/briefing/generate",
                method: "POST",
                body: nil,
                timeout: 120
            )
            await fetch()
            // Re-generating also implicitly "undismisses" — the user clearly
            // wants to see the new version.
            isDismissedToday = false
        } catch {
            lastError = Self.describe(error)
        }
    }

    /// Hide the briefing card for the rest of the local day.
    func dismiss() {
        isDismissedToday = true
    }

    // MARK: - Markdown rendering

    /// Parse the cached `briefing` Markdown into a block-structured view
    /// model. Returns `nil` when there's no briefing.
    ///
    /// Callers typically render via `MarkdownRenderer(source: …)` directly
    /// — this hook is here so tests and non-SwiftUI consumers can inspect
    /// the block segmentation without touching the rendering pipeline.
    func parsedBlocks() -> [MarkdownBlock] {
        guard let briefing, !briefing.isEmpty else { return [] }
        return MarkdownBlock.parse(briefing)
    }

    /// Inline-only `AttributedString` for the briefing, with full syntax
    /// support (bold, italic, code spans, links) and newlines preserved.
    ///
    /// Returns `nil` when there's no briefing cached. Useful for quick
    /// inline renders (e.g. Today header preview) without spinning up the
    /// block renderer.
    func parsedContent() -> AttributedString? {
        guard let briefing, !briefing.isEmpty else { return nil }
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        return (try? AttributedString(markdown: briefing, options: options))
            ?? AttributedString(briefing)
    }

    // MARK: - Helpers

    private static func describe(_ error: Error) -> String {
        if let apiError = error as? APIError {
            switch apiError {
            case .offline: return "You're offline."
            case .unauthorized: return "Sign in again to refresh your briefing."
            case .invalidCredentials: return "Sign in again to refresh your briefing."
            case .rateLimited: return "Too many briefing requests — try again in a minute."
            case .validation(let message): return message
            case .serverError(let status): return "Server error (\(status))."
            case .decodingFailed: return "Couldn't read the briefing response."
            case .unknown: return "Something went wrong."
            }
        }
        return error.localizedDescription
    }
}

// MARK: - Wire types

private struct BriefingResponse: Decodable {
    let briefing: BriefingPayload?
}

private struct BriefingPayload: Decodable {
    let sessionId: String
    let content: String
    let generatedAt: Date
}
