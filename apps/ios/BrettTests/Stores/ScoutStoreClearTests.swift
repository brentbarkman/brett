import Testing
import Foundation
@testable import Brett

@Suite("ScoutStore clear", .tags(.smoke))
@MainActor
struct ScoutStoreClearTests {
    /// `ScoutStore` no longer keeps an in-memory `[ScoutDTO]` cache (Wave B
    /// task 19). The store's only mutable @Observable state is
    /// `errorMessage` and `isLoading`. `clearForSignOut` resets those so
    /// the next sign-in starts from a clean slate; SwiftData rows are
    /// wiped separately via `PersistenceController.wipeAllData()`.
    @Test func clearForSignOutResetsObservableState() throws {
        ClearableStoreRegistry.resetForTesting()
        let store = ScoutStore(client: APIClient.shared, context: nil)
        store.errorMessage = "stale error"

        ClearableStoreRegistry.clearAll()

        #expect(store.errorMessage == nil)
        #expect(store.isLoading == false)
    }
}
