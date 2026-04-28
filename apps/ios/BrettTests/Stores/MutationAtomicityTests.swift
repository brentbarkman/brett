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
        throwingStore.update(id: listId, changes: ["name": "Updated"], userId: "alice")

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

    /// Mirror of `successfulCreateInvokesSyncTriggerOnce` for `ListStore`:
    /// a successful list create must invoke the injected sync trigger once.
    /// Same regression guard — without injection, the production path is a
    /// silent no-op under tests since `ActiveSession.syncManager` is nil.
    @Test func successfulListCreateInvokesSyncTriggerOnce() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let mockTrigger = MockSyncTrigger()
        let store = ListStore(
            context: context,
            saver: LiveSaver(context: context),
            syncManager: mockTrigger
        )

        _ = try store.create(userId: "alice", name: "Push trigger test")

        #expect(mockTrigger.scheduleCallCount == 1)
    }

    /// Symmetry coverage with the create cases: a rolled-back update must
    /// NOT invoke the sync trigger. The seed-via-live-store baseline
    /// captures the create's increment so the assertion is "no NEW push
    /// scheduled by the failed update" rather than "no pushes ever."
    @Test func rolledBackUpdateDoesNotInvokeSyncTrigger() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let mockTrigger = MockSyncTrigger()

        // Seed via a live store (so the create's trigger increment lands).
        let liveStore = ItemStore(
            context: context,
            saver: LiveSaver(context: context),
            syncManager: mockTrigger
        )
        let item = try liveStore.create(
            userId: "alice", title: "Original", type: .task,
            status: .active, dueDate: nil, listId: nil, notes: nil, source: "Brett"
        )
        let baselineCount = mockTrigger.scheduleCallCount  // 1 (from create)

        // Now exercise update via a throwing store on the same context.
        let throwingStore = ItemStore(
            context: context,
            saver: ThrowingSaverWrappingLive(live: LiveSaver(context: context)),
            syncManager: mockTrigger
        )
        throwingStore.update(id: item.id, changes: ["title": "New title"], userId: "alice")

        #expect(mockTrigger.scheduleCallCount == baselineCount, "rolled-back update should NOT invoke sync trigger")
    }

    /// Symmetry coverage with the create cases: a rolled-back delete must
    /// NOT invoke the sync trigger.
    @Test func rolledBackDeleteDoesNotInvokeSyncTrigger() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let mockTrigger = MockSyncTrigger()

        let liveStore = ItemStore(
            context: context,
            saver: LiveSaver(context: context),
            syncManager: mockTrigger
        )
        let item = try liveStore.create(
            userId: "alice", title: "Goner", type: .task,
            status: .active, dueDate: nil, listId: nil, notes: nil, source: "Brett"
        )
        let baselineCount = mockTrigger.scheduleCallCount

        let throwingStore = ItemStore(
            context: context,
            saver: ThrowingSaverWrappingLive(live: LiveSaver(context: context)),
            syncManager: mockTrigger
        )
        throwingStore.delete(id: item.id, userId: "alice")

        #expect(mockTrigger.scheduleCallCount == baselineCount, "rolled-back delete should NOT invoke sync trigger")
    }

    /// Positive symmetry: a successful update must invoke the sync trigger
    /// exactly once on top of the baseline (the create's increment).
    @Test func successfulUpdateInvokesSyncTriggerOnce() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let mockTrigger = MockSyncTrigger()
        let store = ItemStore(
            context: context,
            saver: LiveSaver(context: context),
            syncManager: mockTrigger
        )

        let item = try store.create(
            userId: "alice", title: "Original", type: .task,
            status: .active, dueDate: nil, listId: nil, notes: nil, source: "Brett"
        )
        let baselineCount = mockTrigger.scheduleCallCount  // 1

        store.update(id: item.id, changes: ["title": "Updated"], userId: "alice")

        #expect(mockTrigger.scheduleCallCount == baselineCount + 1, "successful update should invoke sync trigger exactly once")
    }

    // MARK: - Compaction integration

    /// 10 rapid title updates on a brand-new (still-pending-CREATE) item must
    /// collapse into the original CREATE row. This is the headline benefit of
    /// wiring `MutationCompactor` into the store's enqueue path: the push
    /// engine sees a single CREATE with the latest title, not a CREATE plus
    /// 10 UPDATEs. Without this, every keystroke during initial entry would
    /// fan out into its own HTTP round-trip.
    @Test func tenRapidUpdatesAfterCreateProduceOneCompactedQueueEntry() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(
            context: context,
            saver: LiveSaver(context: context)
        )

        let item = try store.create(
            userId: "alice", title: "Original", type: .task,
            status: .active, dueDate: nil, listId: nil, notes: nil, source: "Brett"
        )
        let itemId = item.id

        for i in 0..<10 {
            store.update(id: itemId, changes: ["title": "Version \(i)"], userId: "alice")
        }

        let entries = try context.fetch(
            FetchDescriptor<MutationQueueEntry>(
                predicate: #Predicate { $0.entityType == "item" && $0.entityId == itemId }
            )
        )
        #expect(entries.count == 1, "expected 1 entry after compaction; got \(entries.count)")
        #expect(entries.first?.actionEnum == .create, "the surviving row should be the CREATE with the latest title merged in")

        // And the merged payload should carry the latest title.
        let payloadJSON = entries.first?.payload ?? ""
        let payload = (try? JSONSerialization.jsonObject(with: Data(payloadJSON.utf8))) as? [String: Any]
        #expect(payload?["title"] as? String == "Version 9")
    }

    /// 10 rapid updates on an already-synced row collapse into a single
    /// pending UPDATE. `previousValues` keeps the EARLIEST baseline (the
    /// pre-edit value the server has) so server-side conflict detection
    /// still works after compaction.
    @Test func tenRapidUpdatesOnSyncedRowProduceOneUpdate() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(
            context: context,
            saver: LiveSaver(context: context)
        )

        // Seed an item that's already synced (no CREATE in queue).
        let item = TestFixtures.makeItem(userId: "alice", title: "Original")
        item._syncStatus = SyncStatus.synced.rawValue
        context.insert(item)
        try context.save()
        let itemId = item.id

        for i in 0..<10 {
            store.update(id: itemId, changes: ["title": "V\(i)"], userId: "alice")
        }

        let entries = try context.fetch(
            FetchDescriptor<MutationQueueEntry>(
                predicate: #Predicate { $0.entityType == "item" && $0.entityId == itemId }
            )
        )
        #expect(entries.count == 1, "expected 1 UPDATE after compaction; got \(entries.count)")
        let entry = try #require(entries.first)
        #expect(entry.actionEnum == .update)

        // previousValues retains the earliest baseline so the server can
        // still detect divergence — that's the per-field semantic the
        // compactor preserves on UPDATE+UPDATE.
        let prevJSON = entry.previousValues ?? "{}"
        let prev = (try? JSONSerialization.jsonObject(with: Data(prevJSON.utf8))) as? [String: Any]
        #expect(prev?["title"] as? String == "Original", "earliest previous title should win after compaction")
    }
}
