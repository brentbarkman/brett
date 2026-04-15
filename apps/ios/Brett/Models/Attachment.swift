import Foundation
import SwiftData

/// Mirrors Prisma `Attachment`. File bytes live on S3; this table holds metadata only.
@Model
final class Attachment {
    @Attribute(.unique) var id: String

    var filename: String
    var mimeType: String
    var sizeBytes: Int
    var storageKey: String

    var itemId: String
    var userId: String

    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    // Sync metadata
    var _syncStatus: String = SyncStatus.synced.rawValue
    var _baseUpdatedAt: String?
    var _lastError: String?

    init(
        id: String = UUID().uuidString,
        filename: String,
        mimeType: String,
        sizeBytes: Int,
        storageKey: String,
        itemId: String,
        userId: String,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.filename = filename
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
        self.storageKey = storageKey
        self.itemId = itemId
        self.userId = userId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    var syncStatusEnum: SyncStatus {
        SyncStatus(rawValue: _syncStatus) ?? .synced
    }
}
