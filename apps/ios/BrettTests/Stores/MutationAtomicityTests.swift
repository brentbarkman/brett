import Testing
import Foundation
import SwiftData
@testable import Brett

/// Mutation atomicity guarantees: every store mutation is a single
/// transaction. If `context.save()` fails, the in-memory SwiftData
/// insert AND the queued MutationQueueEntry both roll back together
/// so model + queue stay in lockstep. Without this, a partial-failure
/// leaves a row with no queue entry — sync silently stalls forever.
@Suite("Mutation atomicity", .tags(.smoke))
@MainActor
struct MutationAtomicityTests {
    @Test func createRollsBackBothItemAndQueueOnSaveFailure() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let liveSaver = LiveSaver(context: context)
        let throwingSaver = ThrowingSaverWrappingLive(live: liveSaver)
        let store = ItemStore(context: context, saver: throwingSaver)

        #expect(throws: ThrowingSaverWrappingLive.InjectedError.self) {
            _ = try store.create(
                userId: "alice",
                title: "Test rollback",
                type: .task,
                status: .active,
                dueDate: nil,
                listId: nil,
                notes: nil,
                source: "Brett"
            )
        }

        // After rollback both the Item and the MutationQueueEntry should be absent.
        let items = try context.fetch(FetchDescriptor<Item>())
        #expect(items.filter { $0.title == "Test rollback" }.isEmpty)

        let queueEntries = try context.fetch(FetchDescriptor<MutationQueueEntry>())
        #expect(queueEntries.filter { $0.entityType == "item" }.isEmpty)
    }

    @Test func updateRollsBackOnSaveFailure() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let liveStore = ItemStore(
            context: context,
            saver: LiveSaver(context: context)
        )
        // Seed
        let item = try liveStore.create(
            userId: "alice", title: "Original", type: .task,
            status: .active, dueDate: nil, listId: nil, notes: nil, source: "Brett"
        )
        let originalTitle = item.title
        // `#Predicate` captures only simple values, not KeyPath traversals
        // on captured model instances — hoist the id into a local.
        let itemId = item.id

        // Same context, throwing saver — exercises the production rollback path.
        let throwingStore = ItemStore(
            context: context,
            saver: ThrowingSaverWrappingLive(live: LiveSaver(context: context))
        )
        throwingStore.update(id: itemId, changes: ["title": "New title"])

        let refreshed = try context.fetch(
            FetchDescriptor<Item>(predicate: #Predicate { $0.id == itemId })
        ).first
        #expect(refreshed?.title == originalTitle, "update rollback should restore original title")
    }

    @Test func deleteRollsBackOnSaveFailure() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let liveStore = ItemStore(
            context: context,
            saver: LiveSaver(context: context)
        )
        let item = try liveStore.create(
            userId: "alice", title: "Goner", type: .task,
            status: .active, dueDate: nil, listId: nil, notes: nil, source: "Brett"
        )
        let itemId = item.id

        let throwingStore = ItemStore(
            context: context,
            saver: ThrowingSaverWrappingLive(live: LiveSaver(context: context))
        )
        throwingStore.delete(id: itemId)

        let refreshed = try context.fetch(
            FetchDescriptor<Item>(predicate: #Predicate { $0.id == itemId })
        ).first
        #expect(refreshed != nil, "delete rolled back; item should still exist")
        #expect(refreshed?.deletedAt == nil, "deletedAt should be nil after rollback")
    }

    @Test func toggleStatusRollsBackOnSaveFailure() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let liveStore = ItemStore(
            context: context,
            saver: LiveSaver(context: context)
        )
        let item = try liveStore.create(
            userId: "alice", title: "Toggle me", type: .task,
            status: .active, dueDate: nil, listId: nil, notes: nil, source: "Brett"
        )
        let itemId = item.id

        let throwingStore = ItemStore(
            context: context,
            saver: ThrowingSaverWrappingLive(live: LiveSaver(context: context))
        )
        throwingStore.toggleStatus(id: itemId)

        let refreshed = try context.fetch(
            FetchDescriptor<Item>(predicate: #Predicate { $0.id == itemId })
        ).first
        #expect(refreshed?.status == ItemStatus.active.rawValue, "rollback should restore active status")
    }
}
