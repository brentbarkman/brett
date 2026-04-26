import Testing
import SwiftData
@testable import Brett

@Suite("UserProfileStore clear", .tags(.smoke))
@MainActor
struct UserProfileStoreClearTests {
    @Test func clearForSignOutDropsCachedProfile() throws {
        ClearableStoreRegistry.resetForTesting()
        let context = try InMemoryPersistenceController.makeContext()
        let store = UserProfileStore(context: context)

        let profile = TestFixtures.makeUserProfile(email: "test@brett.app")
        context.insert(profile)
        try context.save()
        _ = store.current  // hydrates cachedProfile
        context.delete(profile)
        try context.save()

        ClearableStoreRegistry.clearAll()

        #expect(store.current == nil)
    }
}
