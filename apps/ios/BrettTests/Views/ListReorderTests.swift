import Foundation
import Testing
import SwiftData
@testable import Brett

/// Verifies that `ListStore.reorder(ids:)` rewrites `sortOrder` on every
/// affected list using the index of the id in the supplied array. The
/// store also enqueues a mutation per changed list; we assert that, too,
/// so the push engine has something to send.
@Suite("ListReorder", .tags(.views))
struct ListReorderTests {

    @MainActor
    @Test("Reordering reshuffles sortOrder to match the supplied sequence")
    func reorderRewritesSortOrder() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ListStore(context: context)

        // Starting state: three lists in order a, b, c (sortOrder 0, 1, 2).
        let a = ItemList(id: "a", userId: "u", name: "Work",     sortOrder: 0)
        let b = ItemList(id: "b", userId: "u", name: "Personal", sortOrder: 1)
        let c = ItemList(id: "c", userId: "u", name: "Reading",  sortOrder: 2)
        a._syncStatus = SyncStatus.synced.rawValue
        b._syncStatus = SyncStatus.synced.rawValue
        c._syncStatus = SyncStatus.synced.rawValue
        context.insert(a)
        context.insert(b)
        context.insert(c)
        try context.save()

        // Act: move c to the front, push a + b down one slot each.
        store.reorder(ids: ["c", "a", "b"], userId: "u")

        // Assert: sortOrder on each list reflects its new index.
        let fetched = store.fetchAll(includeArchived: true)
        let byId = Dictionary(uniqueKeysWithValues: fetched.map { ($0.id, $0) })

        #expect(byId["c"]?.sortOrder == 0)
        #expect(byId["a"]?.sortOrder == 1)
        #expect(byId["b"]?.sortOrder == 2)
    }

    @MainActor
    @Test("Reorder skips lists whose sortOrder is already correct (no-op)")
    func reorderSkipsUnchangedSortOrders() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ListStore(context: context)

        let a = ItemList(id: "a", userId: "u", name: "Work",     sortOrder: 0)
        let b = ItemList(id: "b", userId: "u", name: "Personal", sortOrder: 1)
        a._syncStatus = SyncStatus.synced.rawValue
        b._syncStatus = SyncStatus.synced.rawValue
        context.insert(a)
        context.insert(b)
        try context.save()

        // Supply them in the order they're already in — the store should
        // treat this as a no-op. Count mutation queue entries before and
        // after to prove it.
        let before = try context.fetch(FetchDescriptor<MutationQueueEntry>()).count
        store.reorder(ids: ["a", "b"], userId: "u")
        let after = try context.fetch(FetchDescriptor<MutationQueueEntry>()).count

        #expect(after == before, "no-op reorder must not enqueue any mutations")
        #expect(store.fetchAll(includeArchived: true).map(\.sortOrder) == [0, 1])
    }

    @MainActor
    @Test("Reorder enqueues one UPDATE per list whose sortOrder actually changes")
    func reorderEnqueuesMutationsForChangedListsOnly() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ListStore(context: context)

        let a = ItemList(id: "a", userId: "u", name: "Work",     sortOrder: 0)
        let b = ItemList(id: "b", userId: "u", name: "Personal", sortOrder: 1)
        let c = ItemList(id: "c", userId: "u", name: "Reading",  sortOrder: 2)
        [a, b, c].forEach { $0._syncStatus = SyncStatus.synced.rawValue; context.insert($0) }
        try context.save()

        // Swap a and b → both rows change sortOrder, c stays put.
        store.reorder(ids: ["b", "a", "c"], userId: "u")

        let mutations = try context.fetch(FetchDescriptor<MutationQueueEntry>())
        let updateMutationIds = mutations
            .filter { $0.actionEnum == .update && $0.entityType == "list" }
            .map(\.entityId)

        #expect(updateMutationIds.contains("a"), "a's sortOrder changed — expected enqueued mutation")
        #expect(updateMutationIds.contains("b"), "b's sortOrder changed — expected enqueued mutation")
        #expect(!updateMutationIds.contains("c"), "c's sortOrder was unchanged — no mutation expected")
    }

    @MainActor
    @Test("Unknown ids are silently ignored so a stale cached list can't crash the reorder")
    func reorderIgnoresUnknownIds() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ListStore(context: context)

        let a = ItemList(id: "a", userId: "u", name: "Only list", sortOrder: 5)
        a._syncStatus = SyncStatus.synced.rawValue
        context.insert(a)
        try context.save()

        // Supplying unknown ids around a real one must still succeed and
        // update the real one to its new index (0, since it's first).
        store.reorder(ids: ["a", "ghost-1", "ghost-2"], userId: "u")

        let fetched = store.fetchAll(includeArchived: true)
        #expect(fetched.count == 1)
        #expect(fetched.first?.sortOrder == 0)
    }
}
