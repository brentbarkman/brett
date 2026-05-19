import Foundation
import Observation

/// Observable façade over `GET /things/broken-connections`.
///
/// The server returns one entry per active re-link task, including the
/// connection type, the specific `accountId` that broke (when applicable),
/// a human-readable reason, and the timestamp the prompt was first raised.
/// Settings views consume this to render inline warning chrome on the
/// account card that actually needs attention — so a user with two Granola
/// accounts (one healthy, one revoked) sees the warning only on the broken
/// card.
///
/// Not part of sync-pull: re-link tasks live on the server side and the
/// list is short-lived (one entry per broken account). Re-fetched on view
/// appear; if a future SSE event signals reconnection we can refresh more
/// aggressively.
@MainActor
@Observable
final class BrokenConnectionsStore: Clearable {
    private(set) var details: [APIClient.BrokenConnectionDetail] = []
    private(set) var isLoading: Bool = false
    private(set) var lastError: String?

    private let api: APIClient

    init(api: APIClient = .shared) {
        self.api = api
        ClearableStoreRegistry.register(self)
    }

    // MARK: - Clearable

    func clearForSignOut() {
        details = []
        isLoading = false
        lastError = nil
    }

    // MARK: - Fetch

    func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await api.fetchBrokenConnections()
            details = response.details
            lastError = nil
        } catch {
            // Soft-fail: an empty list lets the UI render the healthy state.
            // Surfacing an error banner on Settings for a transient network
            // blip would be more noise than signal.
            lastError = "Couldn't check connection health."
        }
    }

    // MARK: - Helpers

    /// Returns the broken-connection detail for a specific account if its
    /// re-link prompt is active, otherwise nil. Callers use this to decide
    /// whether to render warning chrome on a card.
    func brokenDetail(
        type: String,
        accountId: String
    ) -> APIClient.BrokenConnectionDetail? {
        details.first(where: { $0.type == type && $0.accountId == accountId })
    }
}
