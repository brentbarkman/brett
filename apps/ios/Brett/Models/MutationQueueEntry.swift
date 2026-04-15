import Foundation
import SwiftData

/// Mirrors `_mutation_queue` from the RN mobile sync engine (spec §2.2).
/// One row per pending write; the push engine drains these FIFO.
///
/// Field-level merge data (changedFields + previousValues) is how the server
/// decides whether our update diverged from a concurrent remote update.
@Model
final class MutationQueueEntry {
    /// Client-generated UUID. Doubles as the HTTP idempotency key.
    @Attribute(.unique) var id: String

    /// Separate idempotency key column matches spec; defaults to `id`.
    var idempotencyKey: String

    var entityType: String          // "item" | "list" | "calendar_event" | "attachment" | ...
    var entityId: String            // target record ID
    var action: String              // MutationAction raw value

    var endpoint: String            // eg "/things/abc123"
    var method: String              // MutationMethod raw value

    var payload: String             // JSON body
    var changedFields: String?      // JSON array of field names (UPDATE only)
    var previousValues: String?     // JSON object of field values BEFORE the edit
    var baseUpdatedAt: String?      // server updatedAt at mutation creation time
    var beforeSnapshot: String?     // full-row JSON for rollback on permanent failure

    var dependsOn: String?          // id of mutation this one depends on
    var batchId: String?            // groups bulk mutations

    var status: String = MutationStatus.pending.rawValue
    var retryCount: Int = 0
    var error: String?
    var errorCode: Int?             // HTTP status of last failure

    var createdAt: Date

    init(
        id: String = UUID().uuidString,
        idempotencyKey: String? = nil,
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
        createdAt: Date = Date()
    ) {
        self.id = id
        self.idempotencyKey = idempotencyKey ?? id
        self.entityType = entityType
        self.entityId = entityId
        self.action = action.rawValue
        self.endpoint = endpoint
        self.method = method.rawValue
        self.payload = payload
        self.changedFields = changedFields
        self.previousValues = previousValues
        self.baseUpdatedAt = baseUpdatedAt
        self.beforeSnapshot = beforeSnapshot
        self.dependsOn = dependsOn
        self.batchId = batchId
        self.createdAt = createdAt
    }

    var actionEnum: MutationAction { MutationAction(rawValue: action) ?? .update }
    var methodEnum: MutationMethod { MutationMethod(rawValue: method) ?? .patch }
    var statusEnum: MutationStatus { MutationStatus(rawValue: status) ?? .pending }
}
