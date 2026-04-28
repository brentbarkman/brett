import Foundation
import SwiftData
import Testing
@testable import Brett

/// Tests for `ItemStore.bulkUpdate(ids:changes:)` and `ItemStore.bulkDelete(ids:)`.
///
/// Bulk ops are how the Inbox triage popup applies a single changeset to many
/// items at once. For the mutation queue to resolve conflicts correctly on the
/// server, each enqueued UPDATE must carry *per-item* `previousValues` rather
/// than one shared snapshot. These tests are the regression guard on that.
@MainActor
@Suite("BulkUpdate", .tags(.views))
struct BulkUpdateTests {

    // MARK: - bulkUpdate

    @Test func enqueuesOneUpdatePerItemWithCorrectChanges() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(context: context)

        // Three items, each initially unassigned to any list.
        let ids = ["a-1", "a-2", "a-3"]
        for id in ids {
            let item = TestFixtures.makeItem(id: id, title: "Task \(id)")
            context.insert(item)
        }
        try context.save()

        store.bulkUpdate(ids: ids, changes: ["listId": "list-new"], userId: TestFixtures.defaultUserId)

        let pending = try fetchMutationEntries(context: context)
            .filter { $0.actionEnum == .update && ids.contains($0.entityId) }

        #expect(pending.count == 3)
        let entityIds = Set(pending.map(\.entityId))
        #expect(entityIds == Set(ids))

        // Every entry must actually carry the change we asked for.
        for entry in pending {
            let payload = try #require(decode(entry.payload))
            #expect(payload["listId"] as? String == "list-new")

            let changed = try #require(decodeArray(entry.changedFields))
            #expect(changed == ["listId"])
        }
    }

    @Test func capturesPerItemPreviousValues() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(context: context)

        // Each item starts on a *different* list so per-item prev values matter.
        let fixtures: [(id: String, list: String)] = [
            ("b-1", "list-old-1"),
            ("b-2", "list-old-2"),
            ("b-3", "list-old-3"),
        ]
        for f in fixtures {
            let item = TestFixtures.makeItem(id: f.id, title: "t", listId: f.list)
            context.insert(item)
        }
        try context.save()

        store.bulkUpdate(
            ids: fixtures.map(\.id),
            changes: ["listId": "list-new"],
            userId: TestFixtures.defaultUserId
        )

        let pending = try fetchMutationEntries(context: context)
            .filter { $0.actionEnum == .update }

        for f in fixtures {
            let entry = try #require(pending.first(where: { $0.entityId == f.id }))
            let prev = try #require(decode(entry.previousValues))
            #expect(prev["listId"] as? String == f.list)
        }
    }

    @Test func appliesChangeLocallyToEveryItem() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(context: context)

        let ids = ["c-1", "c-2"]
        for id in ids {
            let item = TestFixtures.makeItem(id: id, title: "t")
            context.insert(item)
        }
        try context.save()

        store.bulkUpdate(ids: ids, changes: ["listId": "list-applied"], userId: TestFixtures.defaultUserId)

        for id in ids {
            let item = try #require(try fetchItem(id, in: context))
            #expect(item.listId == "list-applied")
        }
    }

    @Test func skipsUnknownIds() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(context: context)

        let real = TestFixtures.makeItem(id: "d-1", title: "t")
        context.insert(real)
        try context.save()

        store.bulkUpdate(
            ids: ["d-1", "d-ghost"],
            changes: ["listId": "list-x"],
            userId: TestFixtures.defaultUserId
        )

        let pending = try fetchMutationEntries(context: context)
            .filter { $0.actionEnum == .update }

        #expect(pending.count == 1)
        #expect(pending.first?.entityId == "d-1")
    }

    @Test func emptyIdsIsNoop() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(context: context)

        store.bulkUpdate(ids: [], changes: ["listId": "list-x"], userId: TestFixtures.defaultUserId)

        let pending = try fetchMutationEntries(context: context)
        #expect(pending.isEmpty)
    }

    @Test func emptyChangesIsNoop() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(context: context)

        let item = TestFixtures.makeItem(id: "e-1", title: "t")
        context.insert(item)
        try context.save()

        store.bulkUpdate(ids: ["e-1"], changes: [:], userId: TestFixtures.defaultUserId)

        let pending = try fetchMutationEntries(context: context)
            .filter { $0.actionEnum == .update }
        #expect(pending.isEmpty)
    }

    // MARK: - bulkDelete

    @Test func bulkDeleteEnqueuesOneDeletePerItem() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(context: context)

        let ids = ["x-1", "x-2"]
        for id in ids {
            let item = TestFixtures.makeItem(id: id, title: "t")
            context.insert(item)
        }
        try context.save()

        store.bulkDelete(ids: ids, userId: TestFixtures.defaultUserId)

        let pending = try fetchMutationEntries(context: context)
            .filter { $0.actionEnum == .delete }

        #expect(pending.count == 2)
        #expect(Set(pending.map(\.entityId)) == Set(ids))

        // Items are soft-deleted locally.
        for id in ids {
            let item = try #require(try fetchItem(id, in: context))
            #expect(item.deletedAt != nil)
            #expect(item.syncStatusEnum == .pendingDelete)
        }
    }

    // MARK: - Helpers

    /// Direct `FetchDescriptor` lookup — replaces `ItemStore.fetchById`,
    /// which Wave B made private. Tests own their inspection of post-mutation
    /// state and don't need to go through the store's mutation surface.
    private func fetchItem(_ id: String, in context: ModelContext) throws -> Item? {
        let descriptor = FetchDescriptor<Item>(
            predicate: #Predicate { $0.id == id }
        )
        return try context.fetch(descriptor).first
    }

    private func fetchMutationEntries(context: ModelContext) throws -> [MutationQueueEntry] {
        let descriptor = FetchDescriptor<MutationQueueEntry>(
            sortBy: [SortDescriptor(\.createdAt)]
        )
        return try context.fetch(descriptor)
    }

    private func decode(_ json: String?) -> [String: Any]? {
        guard let json, let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private func decodeArray(_ json: String?) -> [String]? {
        guard let json, let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String]
    }
}
