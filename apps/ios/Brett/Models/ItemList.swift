import Foundation
import SwiftData

/// Mirrors Prisma `List`. Named `ItemList` because `List` collides with SwiftUI.
@Model
final class ItemList {
    @Attribute(.unique) var id: String
    var userId: String

    var name: String
    var colorClass: String = "bg-gray-500"
    var sortOrder: Int = 0
    var archivedAt: Date?

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
        name: String,
        colorClass: String = "bg-gray-500",
        sortOrder: Int = 0,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.userId = userId
        self.name = name
        self.colorClass = colorClass
        self.sortOrder = sortOrder
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    var syncStatusEnum: SyncStatus {
        SyncStatus(rawValue: _syncStatus) ?? .synced
    }

    var isArchived: Bool { archivedAt != nil }
}

// MARK: - Codable (sync wire format)
//
// Encoding/decoding is asymmetric on purpose: outbound payloads
// (`encode(to:)`) intentionally OMIT `deletedAt` to match the legacy
// `toServerPayload(_ list:)` shape — the server treats deletes via the
// global `/sync/push` `deletes[]` envelope, not a per-row tombstone.
// Inbound (`init(from:)`) DOES read `deletedAt` so hydration from
// `/sync/pull` survives soft-deleted rows.
//
// `archivedAt` is encoded as explicit JSON `null` via `encode` (not
// `encodeIfPresent`) so the wire shape stays byte-compatible with the
// legacy mapper, which emitted `NSNull()` for missing values rather
// than dropping the key. Inbound uses `decodeIfPresent`.
//
// Sync-metadata fields (`_syncStatus`, `_baseUpdatedAt`, `_lastError`)
// are deliberately excluded from both directions: they are local-only
// state and must not be round-tripped through the server.
extension ItemList: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case name
        case colorClass
        case sortOrder
        case archivedAt
        case createdAt
        case updatedAt
        case deletedAt
    }

    public convenience init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let userId = try container.decode(String.self, forKey: .userId)
        let name = try container.decode(String.self, forKey: .name)
        let colorClass = try container.decodeIfPresent(String.self, forKey: .colorClass) ?? "bg-gray-500"
        let sortOrder = try container.decodeIfPresent(Int.self, forKey: .sortOrder) ?? 0
        let createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        let updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()

        self.init(
            id: id,
            userId: userId,
            name: name,
            colorClass: colorClass,
            sortOrder: sortOrder,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
        self.archivedAt = try container.decodeIfPresent(Date.self, forKey: .archivedAt)
        self.deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(userId, forKey: .userId)
        try container.encode(name, forKey: .name)
        try container.encode(colorClass, forKey: .colorClass)
        try container.encode(sortOrder, forKey: .sortOrder)
        // Use `encode` (not `encodeIfPresent`) for nullable date so nil
        // becomes JSON `null` on the wire — matches legacy NSNull behavior.
        try container.encode(archivedAt, forKey: .archivedAt)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        // Note: `deletedAt` is intentionally NOT encoded — the legacy
        // `toServerPayload(_ list:)` did not include it on the wire.
    }
}
