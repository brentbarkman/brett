import Testing
import Foundation
@testable import Brett

@Suite("ScoutStore clear", .tags(.smoke))
@MainActor
struct ScoutStoreClearTests {
    @Test func clearForSignOutDropsInMemoryScouts() {
        ClearableStoreRegistry.resetForTesting()
        let store = ScoutStore(client: APIClient.shared, context: nil)
        store.injectForTesting(scouts: [TestFixtures.makeScoutDTO(name: "S1")])
        #expect(store.scouts.isEmpty == false)

        ClearableStoreRegistry.clearAll()

        #expect(store.scouts.isEmpty)
    }
}
