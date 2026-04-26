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

        #expect(throws: SaverError.self) {
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
        throwingStore.update(id: itemId, changes: ["title": "New title"], userId: "alice")

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
        throwingStore.delete(id: itemId, userId: "alice")

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
        throwingStore.toggleStatus(id: itemId, userId: "alice")

        let refreshed = try context.fetch(
            FetchDescriptor<Item>(predicate: #Predicate { $0.id == itemId })
        ).first
        #expect(refreshed?.status == ItemStatus.active.rawValue, "rollback should restore active status")
    }

    // MARK: - ListStore

    @Test func listCreateRollsBackOnSaveFailure() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let throwingSaver = ThrowingSaverWrappingLive(live: LiveSaver(context: context))
        let store = ListStore(context: context, saver: throwingSaver)

        #expect(throws: SaverError.self) {
            _ = try store.create(userId: "alice", name: "Test rollback")
        }

        let lists = try context.fetch(FetchDescriptor<ItemList>())
        #expect(lists.filter { $0.name == "Test rollback" }.isEmpty)

        let queueEntries = try context.fetch(FetchDescriptor<MutationQueueEntry>())
        #expect(queueEntries.filter { $0.entityType == "list" }.isEmpty)
    }

    @Test func listUpdateRollsBackOnSaveFailure() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let liveStore = ListStore(context: context, saver: LiveSaver(context: context))
        let list = try liveStore.create(userId: "alice", name: "Original")
        let originalName = list.name
        let listId = list.id

        let throwingStore = ListStore(
            context: context,
            saver: ThrowingSaverWrappingLive(live: LiveSaver(context: context))
        )
        throwingStore.update(id: listId, changes: ["name": "Updated"])

        let refreshed = try context.fetch(
            FetchDescriptor<ItemList>(predicate: #Predicate { $0.id == listId })
        ).first
        #expect(refreshed?.name == originalName, "list update rollback should restore original name")
    }

    // MARK: - SyncTrigger injection (Wave B Task 4)

    /// Successful create must invoke `SyncTrigger.schedulePushDebounced()`
    /// exactly once. This is the regression guard on the
    /// `ActiveSession.syncManager` → injected `SyncTrigger` migration:
    /// without injection there's no way to assert the push happened in
    /// tests, and `ActiveSession` is nil under the test harness so the
    /// real production path was previously a silent no-op.
    @Test func successfulCreateInvokesSyncTriggerOnce() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let mockTrigger = MockSyncTrigger()
        let store = ItemStore(
            context: context,
            saver: LiveSaver(context: context),
            syncManager: mockTrigger
        )

        _ = try store.create(
            userId: "alice",
            title: "Push trigger test",
            type: .task,
            status: .active,
            dueDate: nil,
            listId: nil,
            notes: nil,
            source: "Brett"
        )

        #expect(mockTrigger.scheduleCallCount == 1)
    }

    /// Rolled-back create (save threw) must NOT invoke the sync trigger —
    /// otherwise the push engine wakes up to find no queued mutation and
    /// the next real mutation gets bumped a debounce interval.
    @Test func rolledBackCreateDoesNotInvokeSyncTrigger() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let mockTrigger = MockSyncTrigger()
        let store = ItemStore(
            context: context,
            saver: ThrowingSaverWrappingLive(live: LiveSaver(context: context)),
            syncManager: mockTrigger
        )

        #expect(throws: SaverError.self) {
            _ = try store.create(
                userId: "alice",
                title: "Should not push",
                type: .task,
                status: .active,
                dueDate: nil,
                listId: nil,
                notes: nil,
                source: "Brett"
            )
        }

        #expect(mockTrigger.scheduleCallCount == 0)
    }
}
