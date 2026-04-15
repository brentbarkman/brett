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
final class BriefingStore {
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

    private let defaultsKey: String = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return "briefing.dismissed.\(formatter.string(from: Date()))"
    }()

    /// Whether the user has dismissed today's briefing. Backed by
    /// `UserDefaults` so dismissal persists across app launches.
    var isDismissedToday: Bool {
        get { UserDefaults.standard.bool(forKey: defaultsKey) }
        set { UserDefaults.standard.set(newValue, forKey: defaultsKey) }
    }

    private let api: APIClient

    init(api: APIClient = APIClient.shared) {
        self.api = api
    }

    // MARK: - Public API

    /// Fetch today's cached briefing. Safe to call repeatedly — the server
    /// returns whatever was last persisted; there's no autogeneration trigger.
    func fetch() async {
        lastError = nil
        do {
            let response: BriefingResponse = try await api.request(
                BriefingResponse.self,
                path: "/brett/briefing",
                method: "GET"
            )
            briefing = response.briefing?.content
            generatedAt = response.briefing?.generatedAt
        } catch {
            lastError = Self.describe(error)
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

    // MARK: - Helpers

    private static func describe(_ error: Error) -> String {
        if let apiError = error as? APIError {
            switch apiError {
            case .offline: return "You're offline."
            case .unauthorized: return "Sign in again to refresh your briefing."
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
