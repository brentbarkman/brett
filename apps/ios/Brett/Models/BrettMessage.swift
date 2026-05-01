import Foundation
import SwiftData

/// Mirrors Prisma `BrettMessage`. Each message is scoped to an item or a calendar event.
@Model
final class BrettMessage {
    @Attribute(.unique) var id: String

    var userId: String
    var itemId: String?
    var calendarEventId: String?

    var role: String                // MessageRole raw value
    var content: String

    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    // Sync metadata
    var _syncStatus: String = SyncStatus.synced.rawValue
    var _baseUpdatedAt: String?
    var _lastError: String?

    init(
        id: String = UUID().uuidString,
        userId: String,
        role: MessageRole,
        content: String,
        itemId: String? = nil,
        calendarEventId: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.userId = userId
        self.role = role.rawValue
        self.content = content
        self.itemId = itemId
        self.calendarEventId = calendarEventId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    var messageRole: MessageRole { MessageRole(rawValue: role) ?? .user }

    var syncStatusEnum: SyncStatus {
        SyncStatus(rawValue: _syncStatus) ?? .synced
    }
}

// MARK: - Codable (sync wire format)
//
// Encoding/decoding is asymmetric on purpose: outbound payloads
// (`encode(to:)`) intentionally OMIT `deletedAt` to match the legacy
// `toServerPayload(_ msg:)` shape — the server treats deletes via the
// global `/sync/push` `deletes[]` envelope, not a per-row tombstone.
// Inbound (`init(from:)`) DOES read `deletedAt` so hydration from
// `/sync/pull` survives soft-deleted rows.
//
// Nullable fields (`itemId`, `calendarEventId`) are encoded as explicit
// JSON `null` via `encode`/`decodeIfPresent` (NOT `encodeIfPresent`)
// so the wire shape stays byte-compatible with the legacy mapper, which
// emitted `NSNull()` for missing values rather than dropping the key.
//
// Sync-metadata fields (`_syncStatus`, `_baseUpdatedAt`, `_lastError`)
// are deliberately excluded from both directions: they are local-only
// state and must not be round-tripped through the server.
//
// `role` is stored as a `String` on the model (the raw value of
// `MessageRole`) so we encode/decode it as `String` directly. The
// `MessageRole` enum is `String, Codable` but isn't surfaced here.
extension BrettMessage: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case itemId
        case calendarEventId
        case role
        case content
        case createdAt
        case updatedAt
        case deletedAt
    }

    public convenience init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let userId = try container.decode(String.self, forKey: .userId)
        let roleStr = try container.decode(String.self, forKey: .role)
        let role = MessageRole(rawValue: roleStr) ?? .user
        let content = try container.decode(String.self, forKey: .content)
        let itemId = try container.decodeIfPresent(String.self, forKey: .itemId)
        let calendarEventId = try container.decodeIfPresent(String.self, forKey: .calendarEventId)
        let createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        let updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()

        self.init(
            id: id,
            userId: userId,
            role: role,
            content: content,
            itemId: itemId,
            calendarEventId: calendarEventId,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
        self.deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(userId, forKey: .userId)
        try container.encode(role, forKey: .role)
        try container.encode(content, forKey: .content)
        // Use `encode` (not `encodeIfPresent`) for nullable fields so nil
        // becomes JSON `null` on the wire — matches legacy NSNull behavior.
        try container.encode(itemId, forKey: .itemId)
        try container.encode(calendarEventId, forKey: .calendarEventId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        // Note: `deletedAt` is intentionally NOT encoded — the legacy
        // `toServerPayload(_ msg:)` did not include it on the wire.
    }
}
