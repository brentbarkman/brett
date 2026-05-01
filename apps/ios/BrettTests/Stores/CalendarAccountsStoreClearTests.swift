import Testing
@testable import Brett

@Suite("CalendarAccountsStore clear", .tags(.smoke))
@MainActor
struct CalendarAccountsStoreClearTests {
    @Test func clearForSignOutDropsAccounts() {
        ClearableStoreRegistry.resetForTesting()
        let store = CalendarAccountsStore()
        store.injectForTesting(accounts: [TestFixtures.makeCalendarAccount()])
        #expect(store.accounts.isEmpty == false)

        ClearableStoreRegistry.clearAll()

        #expect(store.accounts.isEmpty)
        #expect(store.lastError == nil)
        #expect(store.isLoading == false)
    }
}
