import Testing
@testable import Brett

@Suite("BriefingStore clear", .tags(.smoke))
@MainActor
struct BriefingStoreClearTests {
    @Test func clearForSignOutDropsBriefingAndError() {
        ClearableStoreRegistry.resetForTesting()
        let store = BriefingStore()
        store.injectForTesting(briefing: "## Today's plan", error: "stale error")
        #expect(store.briefing != nil)

        ClearableStoreRegistry.clearAll()

        #expect(store.briefing == nil)
        #expect(store.lastError == nil)
        #expect(store.generatedAt == nil)
    }
}
