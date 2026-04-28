import Testing
import SwiftData
@testable import Brett

/// Sanity check that `UserProfileStore.clearForSignOut()` is callable
/// without crashing. The store is mutation-only after Wave-B Phase 5 —
/// views read `UserProfile` via `@Query`, so there's no in-memory cache
/// for `clearForSignOut` to drop. The actual sign-out wipe happens via
/// `PersistenceController.wipeAllData()`, not here. Kept as a regression
/// guard against re-introducing observable state without a clear hook.
@Suite("UserProfileStore clear", .tags(.smoke))
@MainActor
struct UserProfileStoreClearTests {
    @Test func clearForSignOutDoesNotCrashWithoutCachedState() throws {
        ClearableStoreRegistry.resetForTesting()
        let context = try InMemoryPersistenceController.makeContext()
        let store = UserProfileStore(context: context)

        // Insert a row so there's something in SwiftData to potentially
        // cache. The store should not crash regardless.
        let profile = TestFixtures.makeUserProfile(email: "test@brett.app")
        context.insert(profile)
        try context.save()

        ClearableStoreRegistry.clearAll()

        // No assertion target — the store no longer exposes a read API.
        // Test passes if `clearForSignOut()` returns without throwing.
        _ = store
    }
}
