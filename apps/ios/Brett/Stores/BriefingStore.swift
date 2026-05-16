import Foundation
import Observation

/// Observable facade around the Daily Briefing API.
///
/// v2 contract (mounted at `/brett` — see `apps/api/src/app.ts`):
/// - `GET /brett/briefing/current` → `{ briefing, staleness: fresh|dirty|capped }`
/// - `POST /brett/briefing/refresh` → 202 (fire-and-forget; pipeline runs
///   server-side and updates the row in place).
///
/// Client behavior:
/// - `fetch()` always returns instantly with the cached row.
/// - If `staleness == .dirty`, fire `/refresh` once and schedule a refetch
///   ~2.5s later. Subsequent dirty states (e.g. re-foreground) only re-fire
///   when the server has produced a new briefing since the last refresh.
///
/// "Dismissed today" is tracked in `UserDefaults` per-day so closing the app
/// doesn't bring it back, but tomorrow's briefing will reappear.
///
/// See docs/superpowers/specs/2026-05-16-briefing-pipeline-v2-design.md.
@MainActor
@Observable
final class BriefingStore: Clearable {
    /// Prose content from the server (1-2 sentences). `nil` when no briefing
    /// exists yet for this user.
    private(set) var briefing: String?

    /// Whether this briefing was generated from a quiet-day template (vs.
    /// the Sonnet writer). UI may render templated copy with a subtler tone.
    private(set) var isEmpty: Bool = false

    /// Timestamp the briefing was last materialized. Useful if the UI wants
    /// to show "generated 12 minutes ago" style copy.
    private(set) var generatedAt: Date?

    /// Whether we're currently waiting for a refresh to land. The card shows
    /// the previous content immediately; this only affects subtle affordances
    /// like the regenerate spinner.
    private(set) var isGenerating: Bool = false

    /// Last error message from fetch/refresh — surfaced to the card so the
    /// user gets something better than a silent empty state.
    private(set) var lastError: String?

    /// Computed every access so the "dismissed today" bit rolls over the
    /// moment the local date changes. Scoped per-user so two accounts on
    /// the same device don't share state.
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

    /// Tracks the `generatedAt` of the last briefing we fired `/refresh` for.
    /// Clears whenever the server produces a new briefing, so the next dirty
    /// signal triggers a fresh refresh — without this, a single dirty state
    /// could fire `/refresh` repeatedly across re-foreground events.
    private var refreshFiredForGeneratedAt: Date?

    private let api: APIClient

    init(api: APIClient = APIClient.shared) {
        self.api = api
        ClearableStoreRegistry.register(self)
        #if DEBUG
        // UI-test launches and design-review sessions skip the
        // network fetch; pre-populate the store with a representative
        // brief so the editorial hero on Today shows real copy
        // instead of just the greeting + date.
        if ProcessInfo.processInfo.arguments.contains("-UITEST_FAKE_AUTH") {
            // Verbatim from the v2 design spec — 1-2 sentences, ~140 chars.
            self.briefing = "Sara pushed your 2pm to 3:30, and the board call still has no notes. Alex replied on Q3 — and you owe him a hiring update."
            self.generatedAt = Date()
        }
        #endif
    }

    // MARK: - Clearable

    func clearForSignOut() {
        briefing = nil
        isEmpty = false
        generatedAt = nil
        lastError = nil
        isGenerating = false
        refreshFiredForGeneratedAt = nil
    }

    #if DEBUG
    /// Test-only: populate in-memory state without touching the network.
    func injectForTesting(briefing: String?, isEmpty: Bool = false, error: String? = nil) {
        self.briefing = briefing
        self.isEmpty = isEmpty
        self.generatedAt = briefing != nil ? Date() : nil
        self.lastError = error
    }
    #endif

    // MARK: - Public API

    /// Fetch the current briefing and, if the server reports `dirty`, fire a
    /// background refresh + schedule a refetch. Safe to call repeatedly — the
    /// refresh-fired latch prevents thrash on focus events.
    ///
    /// Failure mode: if the request errors out we DO NOT replace an existing
    /// cached briefing with an error message — a transient sync error
    /// shouldn't blow away real content. A quiet retry on the next fetch is
    /// better than a loud "something went wrong" overwriting the brief.
    func fetch() async {
        do {
            let response: BriefingCurrentResponse = try await api.request(
                BriefingCurrentResponse.self,
                path: "/brett/briefing/current",
                method: "GET"
            )
            if let payload = response.briefing {
                briefing = payload.content
                isEmpty = payload.isEmpty
                generatedAt = payload.generatedAt
                // Clear the refresh latch when the server has produced a new
                // briefing since we last fired refresh.
                if refreshFiredForGeneratedAt != payload.generatedAt {
                    refreshFiredForGeneratedAt = nil
                }
            }
            lastError = nil

            if response.staleness == .dirty {
                await fireBackgroundRefresh()
            }
        } catch {
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

    /// Manual regenerate (e.g. user pulls a refresh affordance). Bypasses the
    /// client-side latch but still respects server-side gates (30min floor,
    /// 6/day ceiling) so a rapid tap does not burn tokens.
    func regenerate() async {
        guard !isGenerating else { return }
        isGenerating = true
        lastError = nil
        defer { isGenerating = false }

        do {
            _ = try await api.rawRequest(
                path: "/brett/briefing/refresh",
                method: "POST",
                body: nil,
                timeout: 30
            )
            // The pipeline runs server-side; give it ~2.5s before re-fetching.
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            await fetch()
            // Regenerating also implicitly "undismisses" — the user clearly
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
    //
    // The v2 writer emits prose, not bullets — there's no markdown structure
    // to flatten anymore. We keep `parsedBlocks` / `parsedContent` so existing
    // UI call sites still compile; both now just wrap the plain prose.

    func parsedBlocks() -> [MarkdownBlock] {
        guard let briefing, !briefing.isEmpty else { return [] }
        return MarkdownBlock.parse(briefing)
    }

    func parsedContent() -> AttributedString? {
        guard let briefing, !briefing.isEmpty else { return nil }
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        return (try? AttributedString(markdown: briefing, options: options))
            ?? AttributedString(briefing)
    }

    // MARK: - Helpers

    /// Fire a one-shot background refresh + schedule a refetch. Idempotent
    /// per-generatedAt so concurrent focus events don't re-fire.
    private func fireBackgroundRefresh() async {
        if refreshFiredForGeneratedAt == generatedAt && generatedAt != nil {
            return
        }
        refreshFiredForGeneratedAt = generatedAt
        Task.detached { [api] in
            _ = try? await api.rawRequest(
                path: "/brett/briefing/refresh",
                method: "POST",
                body: nil,
                timeout: 30
            )
        }
        // Refetch after the pipeline likely settled.
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            await self?.fetch()
        }
    }

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
            case .keychainWriteFailed:
                // Unreachable — briefing paths don't write to keychain. Kept
                // for exhaustive switch.
                return "Something went wrong."
            }
        }
        return error.localizedDescription
    }
}

// MARK: - Wire types

private struct BriefingCurrentResponse: Decodable {
    let briefing: BriefingPayload?
    let staleness: Staleness

    enum Staleness: String, Decodable {
        case fresh
        case dirty
        case capped
    }
}

private struct BriefingPayload: Decodable {
    let content: String
    let isEmpty: Bool
    let generatedAt: Date
}
