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
}
