import Testing
@testable import Brett

@Suite("SearchStore clear", .tags(.smoke))
@MainActor
struct SearchStoreClearTests {
    @Test func clearForSignOutDropsResultsAndCancelsInFlightSearch() {
        ClearableStoreRegistry.resetForTesting()
        let store = SearchStore()
        store.injectForTesting(results: [TestFixtures.makeSearchResult(title: "Stale")])
        #expect(store.results.isEmpty == false)

        ClearableStoreRegistry.clearAll()

        #expect(store.results.isEmpty)
        #expect(store.isSearching == false)
        #expect(store.hasInFlightTask == false)
    }
}
