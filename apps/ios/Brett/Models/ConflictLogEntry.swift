import Foundation
import SwiftData

/// Mirrors `_conflict_log`. One row every time the conflict resolver picks a
/// winner between a local edit and a concurrent remote edit.
@Model
final class ConflictLogEntry {
    @Attribute(.unique) var id: String

    var entityType: String
    var entityId: String
    var mutationId: String?             // MutationQueueEntry.id if caused by a push

    var localValuesJSON: String         // what the client tried to write
    var serverValuesJSON: String        // what the server had
    var conflictedFieldsJSON: String    // JSON array of field names where server won

    /// "server_wins" | "local_wins" | "merged" | nil (unresolved).
    var resolution: String?
    var resolvedAt: Date?

    init(
        id: String = UUID().uuidString,
        entityType: String,
        entityId: String,
        mutationId: String? = nil,
        localValuesJSON: String,
        serverValuesJSON: String,
        conflictedFieldsJSON: String,
        resolution: String? = nil,
        resolvedAt: Date? = nil
    ) {
        self.id = id
        self.entityType = entityType
        self.entityId = entityId
        self.mutationId = mutationId
        self.localValuesJSON = localValuesJSON
        self.serverValuesJSON = serverValuesJSON
        self.conflictedFieldsJSON = conflictedFieldsJSON
        self.resolution = resolution
        self.resolvedAt = resolvedAt
    }
}
