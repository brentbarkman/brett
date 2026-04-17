import Foundation
import Observation

/// Lightweight observable cache of "does the user have a configured, valid,
/// active AI provider?". Gated features (scout creation, Brett chat) read
/// `hasActiveProvider` to decide whether to show their real UI or a
/// "configure an AI provider first" state.
///
/// Kept separate from the list-of-configs state owned by
/// `AIProviderSettingsView` so views that only care about the gate don't
/// have to know about the full `AIConfigEntry` shape.
///
/// State starts as `nil` (unchecked). Callers invoke `refresh()` from a
/// `.task` modifier; while nil the caller should render neutrally (no
/// pre-emptive gate flash). After the first refresh the value is either
/// `true` or `false` until the next explicit refresh.
@MainActor
@Observable
final class AIProviderStore {
    static let shared = AIProviderStore()

    private(set) var hasActiveProvider: Bool?

    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    /// Fetch `/ai/config` and update `hasActiveProvider`. Swallows errors
    /// and treats them as "no provider" — an auth failure here means the
    /// user needs to sign in again, which is handled elsewhere; a network
    /// failure means we don't know, so the gate flashing in is acceptable.
    /// Callers that need strict error handling should use the list view
    /// instead.
    func refresh() async {
        struct Response: Decodable { let configs: [AIConfigEntry] }
        do {
            let response: Response = try await client.request(
                Response.self,
                path: "/ai/config",
                method: "GET"
            )
            hasActiveProvider = response.configs.contains { $0.isActive && $0.isValid }
        } catch {
            hasActiveProvider = false
        }
    }

    /// Called by `AIProviderSettingsView` after an add/activate/delete so
    /// the cache reflects the mutation without the user having to pull
    /// to refresh somewhere else.
    func invalidate() {
        Task { await refresh() }
    }
}
