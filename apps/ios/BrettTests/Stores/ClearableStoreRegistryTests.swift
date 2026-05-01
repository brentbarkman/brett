import Testing
import Foundation
@testable import Brett

@Suite("ClearableStoreRegistry", .tags(.smoke))
@MainActor
struct ClearableStoreRegistryTests {
    /// Test double — counts how many times clearForSignOut was called.
    @MainActor
    private final class CountingStore: Clearable {
        var clears: Int = 0
        func clearForSignOut() { clears += 1 }
    }

    @Test func clearAllInvokesEveryRegisteredStore() {
        ClearableStoreRegistry.resetForTesting()
        let a = CountingStore()
        let b = CountingStore()
        ClearableStoreRegistry.register(a)
        ClearableStoreRegistry.register(b)

        ClearableStoreRegistry.clearAll()

        #expect(a.clears == 1)
        #expect(b.clears == 1)
    }

    @Test func releasedStoresAreSilentlySkipped() {
        ClearableStoreRegistry.resetForTesting()
        var a: CountingStore? = CountingStore()
        ClearableStoreRegistry.register(a!)

        // Drop the store. The registry holds a weak reference, so the next
        // clearAll should silently skip the entry rather than crash.
        a = nil

        ClearableStoreRegistry.clearAll()
        // No assertion — the test passes if no crash occurred.
    }

    @Test func registrationIsIdempotentForSameInstance() {
        ClearableStoreRegistry.resetForTesting()
        let store = CountingStore()
        ClearableStoreRegistry.register(store)
        ClearableStoreRegistry.register(store)

        ClearableStoreRegistry.clearAll()

        // Even if registered twice, clear is invoked once per identity.
        #expect(store.clears == 1)
    }
}

@Suite("ClearableStoreRegistry session integration", .tags(.auth, .smoke))
@MainActor
struct ClearableStoreRegistrySessionIntegrationTests {
    @MainActor
    private final class CountingStore: Clearable {
        var clears: Int = 0
        func clearForSignOut() { clears += 1 }
    }

    @Test func sessionTearDownClearsRegisteredStores() {
        ClearableStoreRegistry.resetForTesting()
        let store = CountingStore()
        ClearableStoreRegistry.register(store)

        let persistence = PersistenceController.makePreview()
        let session = Session(userId: "user-A", persistence: persistence)
        // Deliberately skip `session.start()` — it touches the real
        // `SSEClient.shared` singleton and triggers a real push/pull cycle
        // against the API, neither of which is needed to verify the
        // invariant under test (`tearDown` calls `ClearableStoreRegistry.clearAll`).
        session.tearDown()

        #expect(store.clears == 1)
    }
}
