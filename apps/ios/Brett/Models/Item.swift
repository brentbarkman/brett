import Foundation
import SwiftData

/// Mirrors `Item` in `apps/api/prisma/schema.prisma`.
/// Sync-aware: tracks `_syncStatus` / `_baseUpdatedAt` / `_lastError` for
/// the offline-first mutation queue + pull engine.
@Model
final class Item {
    // MARK: - Identity / ownership
    @Attribute(.unique) var id: String
    var userId: String

    // MARK: - Core fields
    var type: String                 // ItemType raw value ("task" | "content")
    var status: String               // ItemStatus raw value
    var title: String
    var itemDescription: String?     // Prisma: description (reserved in Swift)
    var notes: String?
    var source: String
    var sourceId: String?
    var sourceUrl: String?
    var dueDate: Date?
    var dueDatePrecision: String?    // "day" | "week" | nil
    var completedAt: Date?
    var snoozedUntil: Date?
    var reminder: String?
    var recurrence: String?
    var recurrenceRule: String?
    var brettObservation: String?
    var brettTakeGeneratedAt: Date?

    // MARK: - Content (link / article / etc.)
    var contentType: String?
    var contentStatus: String?
    var contentTitle: String?
    var contentDescription: String?
    var contentImageUrl: String?
    var contentBody: String?
    var contentFavicon: String?
    var contentDomain: String?
    var contentMetadata: String?     // JSON string

    // MARK: - Relations (denormalised as foreign-key IDs — no FK enforcement)
    var listId: String?
    var meetingNoteId: String?       // Prisma Item.meetingNoteId (maps to GranolaMeeting)

    // MARK: - Timestamps
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    // MARK: - Sync metadata (prefix `_` matches RN mobile and spec §2.2)
    var _syncStatus: String = SyncStatus.synced.rawValue
    var _baseUpdatedAt: String?      // ISO-8601 server updatedAt at last pull
    var _lastError: String?
    var _provisionalParentId: String?

    init(
        id: String = UUID().uuidString,
        userId: String,
        type: ItemType = .task,
        status: ItemStatus = .active,
        title: String,
        source: String = "Brett",
        dueDate: Date? = nil,
        listId: String? = nil,
        notes: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.userId = userId
        self.type = type.rawValue
        self.status = status.rawValue
        self.title = title
        self.source = source
        self.dueDate = dueDate
        self.listId = listId
        self.notes = notes
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    // MARK: - Typed helpers (computed, not persisted)
    var itemType: ItemType { ItemType(rawValue: type) ?? .task }
    var itemStatus: ItemStatus { ItemStatus(rawValue: status) ?? .active }
    var isCompleted: Bool { itemStatus == .done }

    var syncStatusEnum: SyncStatus {
        SyncStatus(rawValue: _syncStatus) ?? .synced
    }

    var contentMetadataDecoded: [String: Any]? {
        guard let json = contentMetadata?.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: json) as? [String: Any]
    }
}
