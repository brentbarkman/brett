import Testing
import Foundation
import SwiftData
@testable import Brett

/// Tests for the new `ItemStore.update(id:changes:)` auto-capture path
/// and the bug fix in `toggleStatus` where the pre-refactor code captured
/// `beforeSnapshot` *after* mutating the model, breaking rollback.
@Suite("ItemStore.update")
@MainActor
struct ItemStoreUpdateTests {

    private func makeHarness() throws -> (ItemStore, ModelContext) {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        return (ItemStore(context: context), context)
    }

    // MARK: - Auto-capture form

    @Test func updateWithoutExplicitPreviousValuesCapturesFromModel() throws {
        let (store, context) = try makeHarness()
        let item = Item(userId: "u1", title: "original", notes: "before")
        context.insert(item)
        try context.save()

        store.update(id: item.id, changes: ["title": "edited", "notes": "after"], userId: "u1")

        // Find the resulting mutation queue entry and verify previousValues.
        // The id is hoisted into a local value — `#Predicate` captures only
        // simple values, not KeyPath traversals on captured model instances.
        let itemId = item.id
        let queueDescriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.entityType == "item" && $0.entityId == itemId }
        )
        let queue = try context.fetch(queueDescriptor)
        #expect(queue.count == 1)

        let entry = try #require(queue.first)
        let prev = try #require(decodeJSON(entry.previousValues))

        #expect(prev["title"] as? String == "original")
        #expect(prev["notes"] as? String == "before")

        // And the model itself is mutated.
        #expect(item.title == "edited")
        #expect(item.notes == "after")
    }

    // MARK: - beforeSnapshot regression guard

    @Test func toggleStatusSnapshotsPreMutationState() throws {
        // The refactor's load-bearing fix: toggleStatus used to mutate
        // item.status + item.completedAt BEFORE calling update(), so the
        // beforeSnapshot captured the post-toggle values. Rollback on
        // permanent failure would then be a no-op. Regression guard:
        // beforeSnapshot.status must match the PRE-toggle value.
        let (store, context) = try makeHarness()
        let item = Item(userId: "u1", title: "t")
        item.status = ItemStatus.active.rawValue
        item.completedAt = nil
        context.insert(item)
        try context.save()

        store.toggleStatus(id: item.id, userId: "u1")

        let itemId = item.id
        let queueDescriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.entityType == "item" && $0.entityId == itemId }
        )
        let queue = try context.fetch(queueDescriptor)
        let entry = try #require(queue.first)
        let snapshot = try #require(decodeJSON(entry.beforeSnapshot))

        #expect(snapshot["status"] as? String == ItemStatus.active.rawValue)
        // completedAt was nil → snapshot records NSNull (preserved across
        // JSON round-trip so the distinction between "clear" and "omit"
        // survives all the way to the server).
        #expect(snapshot["completedAt"] is NSNull)

        // And the item itself is now done.
        #expect(item.itemStatus == .done)
        #expect(item.completedAt != nil)
    }

    // MARK: - Explicit previousValues path (ItemDraft compatibility)

    @Test func updateWithExplicitPreviousValuesIsRespected() throws {
        // ItemDraft captures pre-edit state at form-open time and passes
        // it into update(). The store must prefer the caller-supplied
        // previousValues over re-snapshotting from the current model
        // (which by then reflects the user's typing in the form).
        let (store, context) = try makeHarness()
        let item = Item(userId: "u1", title: "live title")
        context.insert(item)
        try context.save()

        store.update(
            id: item.id,
            changes: ["title": "new"],
            previousValues: ["title": "form-open-title"],
            userId: "u1"
        )

        let itemId = item.id
        let queueDescriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.entityType == "item" && $0.entityId == itemId }
        )
        let entry = try #require(try context.fetch(queueDescriptor).first)
        let prev = try #require(decodeJSON(entry.previousValues))

        #expect(prev["title"] as? String == "form-open-title")
    }

    // MARK: - Helpers

    private func decodeJSON(_ string: String?) -> [String: Any]? {
        guard let string, let data = string.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}
