import Testing
import Foundation
import SwiftData
@testable import Brett

/// Integration-lite coverage of the multi-user invariant: after a sign-out,
/// no row from the prior user appears in the current user's view of the
/// world. This exercises the lower-level contract (PersistenceController
/// wipe + userId-scoped fetches) that Wave A.4 introduced.
///
/// A full AuthManager-signOut test is harder to isolate in a unit harness
/// because `signOut()` calls `endpoints.signOut()` and tears down
/// ActiveSession. This test takes the direct path: populate both users'
/// rows, wipe the persistence store (the same call signOut makes), assert
/// nothing left. Plus a scoped-fetch check that confirms the userId
/// predicate does what its name promises.
@Suite("Two-user sign-out flow")
@MainActor
struct TwoUserSignOutTests {

    @Test func wipeAllDataClearsEveryTable() throws {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)

        // Populate rows for two different users across every model type
        // PersistenceController.wipeAllData is responsible for.
        context.insert(Item(userId: "alice", title: "a"))
        context.insert(Item(userId: "bob", title: "b"))
        context.insert(ItemList(userId: "alice", name: "Alice list"))
        context.insert(ItemList(userId: "bob", name: "Bob list"))
        context.insert(BrettMessage(userId: "alice", role: .user, content: "hi"))
        context.insert(BrettMessage(userId: "bob", role: .user, content: "hi"))
        try context.save()

        // Sanity — everything inserted.
        #expect(try context.fetch(FetchDescriptor<Item>()).count == 2)
        #expect(try context.fetch(FetchDescriptor<ItemList>()).count == 2)
        #expect(try context.fetch(FetchDescriptor<BrettMessage>()).count == 2)

        // This is exactly what AuthManager.signOut → wipeAllData does.
        PersistenceController.wipeAllData(in: context)

        #expect(try context.fetch(FetchDescriptor<Item>()).isEmpty)
        #expect(try context.fetch(FetchDescriptor<ItemList>()).isEmpty)
        #expect(try context.fetch(FetchDescriptor<BrettMessage>()).isEmpty)
    }

    @Test func scopedFetchIsolatesUsersWithoutWipe() throws {
        // This is the defense-in-depth layer Wave A.4 added: even before
        // the wipe has run (or if it silently fails), the scoped fetch
        // returns only the current user's rows.
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        let itemStore = ItemStore(context: context)
        let listStore = ListStore(context: context)

        context.insert(Item(userId: "alice", title: "alice only"))
        context.insert(Item(userId: "bob", title: "bob only"))
        context.insert(ItemList(userId: "alice", name: "alice list"))
        context.insert(ItemList(userId: "bob", name: "bob list"))
        try context.save()

        let aliceItems = itemStore.fetchAll(userId: "alice")
        #expect(aliceItems.count == 1)
        #expect(aliceItems.first?.title == "alice only")

        let bobLists = listStore.fetchAll(userId: "bob")
        #expect(bobLists.count == 1)
        #expect(bobLists.first?.name == "bob list")
    }

    @Test func syncStatusSurvivesFullResyncWipe() throws {
        // The wipeLocalRecordsForFullResync branch of PullEngine drops
        // synced rows but preserves pending-mutation rows so an offline
        // user's queued edits aren't lost when the server invalidates
        // cursors. We can't easily test PullEngine's full flow here
        // (needs stubbed /sync/pull), but we can cover the SyncTrackedModel
        // invariant it depends on.
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)

        let synced = Item(userId: "alice", title: "server copy")
        synced._syncStatus = SyncStatus.synced.rawValue

        let pending = Item(userId: "alice", title: "local edit")
        pending._syncStatus = SyncStatus.pendingUpdate.rawValue

        context.insert(synced)
        context.insert(pending)
        try context.save()

        #expect(synced.syncStatus == .synced)
        #expect(pending.syncStatus == .pendingUpdate)

        // Surrogate for the wipe loop in PullEngine.wipeSyncedRows:
        for row in try context.fetch(FetchDescriptor<Item>()) where row.syncStatus == .synced {
            context.delete(row)
        }
        try context.save()

        let remaining = try context.fetch(FetchDescriptor<Item>())
        #expect(remaining.count == 1)
        #expect(remaining.first?.title == "local edit")
    }
}
