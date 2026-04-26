import Testing
import Foundation
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

    /// Regression: `recentQueries` is persisted to `UserDefaults.standard`
    /// under a non-user-scoped key. Without an explicit wipe, user B would
    /// inherit user A's search history after sign-in on a shared device.
    @Test func clearForSignOutWipesRecentQueriesInMemoryAndOnDisk() {
        ClearableStoreRegistry.resetForTesting()

        let key = SearchStore.recentQueriesDefaultsKey
        let defaults = UserDefaults.standard
        defaults.set(["alice's secret search", "another"], forKey: key)

        let store = SearchStore()
        // Constructor loads from defaults — the seeded values should now be
        // in memory.
        #expect(store.recentQueries.isEmpty == false)
        #expect(defaults.array(forKey: key) != nil)

        ClearableStoreRegistry.clearAll()

        #expect(store.recentQueries.isEmpty)
        #expect(defaults.array(forKey: key) == nil)
    }

    @Test func clearForSignOutResetsActiveTypeFilter() {
        ClearableStoreRegistry.resetForTesting()
        let store = SearchStore()
        store.injectForTesting(activeTypes: [.item, .calendarEvent])
        #expect(store.activeTypes.isEmpty == false)

        ClearableStoreRegistry.clearAll()

        #expect(store.activeTypes.isEmpty)
    }
}
