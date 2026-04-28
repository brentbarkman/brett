import Foundation
import SwiftData
@testable import Brett

/// Test-only convenience that mirrors the historical `MutationQueue.enqueue`
/// API. Production callers stage entries via
/// `MutationCompactor.compactAndApply(_:in:)` directly inside their store
/// transaction so the optimistic SwiftData write and the queue-entry insert
/// commit (or roll back) atomically — no save happens at the queue layer.
///
/// Keeping the legacy shape here lets the queue-lifecycle tests
/// (`MutationQueueTests`, `IntegrationFlowTests`) seed state with one call
/// and assert FIFO / dependency / failure semantics without rewriting every
/// case to construct entries by hand.
@MainActor
extension MutationQueue {
    @discardableResult
    func enqueue(
        entityType: String,
        entityId: String,
        action: MutationAction,
        endpoint: String,
        method: MutationMethod,
        payload: String,
        changedFields: String? = nil,
        previousValues: String? = nil,
        baseUpdatedAt: String? = nil,
        beforeSnapshot: String? = nil,
        dependsOn: String? = nil,
        batchId: String? = nil,
        idempotencyKey: String? = nil,
        now: Date = Date()
    ) -> MutationQueueEntry? {
        let incoming = MutationQueueEntry(
            idempotencyKey: idempotencyKey,
            entityType: entityType,
            entityId: entityId,
            action: action,
            endpoint: endpoint,
            method: method,
            payload: payload,
            changedFields: changedFields,
            previousValues: previousValues,
            baseUpdatedAt: baseUpdatedAt,
            beforeSnapshot: beforeSnapshot,
            dependsOn: dependsOn,
            batchId: batchId,
            createdAt: now
        )
        let incomingId = incoming.id
        let incomingKey = incoming.idempotencyKey

        MutationCompactor.compactAndApply(incoming, in: context)
        try? context.save()

        // Mirror the old API: return the entry that ended up persisted. After
        // compaction the queue holds at most one row per (entity, action) so:
        //   - if the incoming entry survived, it's still in the context with
        //     its original id;
        //   - if the compactor merged it into an existing CREATE/UPDATE,
        //     return that merged row, identifiable by its idempotencyKey
        //     (unchanged) — fall back to a plain entity-scoped lookup if the
        //     idempotency key was never seen (CREATE+DELETE net-zero case).
        var byId = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.id == incomingId }
        )
        byId.fetchLimit = 1
        byId.includePendingChanges = true
        if let hit = (try? context.fetch(byId))?.first {
            return hit
        }

        var byKey = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.idempotencyKey == incomingKey }
        )
        byKey.fetchLimit = 1
        byKey.includePendingChanges = true
        if let hit = (try? context.fetch(byKey))?.first {
            return hit
        }

        return nil
    }
}
