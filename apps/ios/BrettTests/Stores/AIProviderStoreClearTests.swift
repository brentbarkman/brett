import Testing
@testable import Brett

@Suite("AIProviderStore clear", .tags(.smoke))
@MainActor
struct AIProviderStoreClearTests {
    @Test func clearForSignOutDropsHasActiveProvider() {
        ClearableStoreRegistry.resetForTesting()
        let store = AIProviderStore()
        store.injectForTesting(hasActiveProvider: true)
        #expect(store.hasActiveProvider == true)

        ClearableStoreRegistry.clearAll()

        #expect(store.hasActiveProvider == nil)
    }
}
