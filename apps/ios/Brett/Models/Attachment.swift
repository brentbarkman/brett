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

// MARK: - Codable (sync wire format)
//
// Encoding/decoding is asymmetric on purpose: outbound payloads
// (`encode(to:)`) intentionally OMIT `deletedAt` to match the legacy
// `toServerPayload(_ att:)` shape — the server treats deletes via the
// global `/sync/push` `deletes[]` envelope, not a per-row tombstone.
// Inbound (`init(from:)`) DOES read `deletedAt` so hydration from
// `/sync/pull` survives soft-deleted rows.
//
// Sync-metadata fields (`_syncStatus`, `_baseUpdatedAt`, `_lastError`)
// are deliberately excluded from both directions: they are local-only
// state and must not be round-tripped through the server.
extension Attachment: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case filename
        case mimeType
        case sizeBytes
        case storageKey
        case itemId
        case userId
        case createdAt
        case updatedAt
        case deletedAt
    }

    public convenience init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let filename = try container.decode(String.self, forKey: .filename)
        let mimeType = try container.decode(String.self, forKey: .mimeType)
        let sizeBytes = try container.decode(Int.self, forKey: .sizeBytes)
        let storageKey = try container.decode(String.self, forKey: .storageKey)
        let itemId = try container.decode(String.self, forKey: .itemId)
        let userId = try container.decode(String.self, forKey: .userId)
        let createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        let updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()

        self.init(
            id: id,
            filename: filename,
            mimeType: mimeType,
            sizeBytes: sizeBytes,
            storageKey: storageKey,
            itemId: itemId,
            userId: userId,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
        self.deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(filename, forKey: .filename)
        try container.encode(mimeType, forKey: .mimeType)
        try container.encode(sizeBytes, forKey: .sizeBytes)
        try container.encode(storageKey, forKey: .storageKey)
        try container.encode(itemId, forKey: .itemId)
        try container.encode(userId, forKey: .userId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        // Note: `deletedAt` is intentionally NOT encoded — the legacy
        // `toServerPayload(_ att:)` did not include it on the wire.
    }
}
