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

// MARK: - Codable

extension Item: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case type
        case status
        case title
        /// Swift property is `itemDescription` (collision with
        /// `CustomStringConvertible`) — wire key stays `"description"`.
        case itemDescription = "description"
        case notes
        case source
        case sourceId
        case sourceUrl
        case dueDate
        case dueDatePrecision
        case completedAt
        case snoozedUntil
        case reminder
        case recurrence
        case recurrenceRule
        case brettObservation
        case brettTakeGeneratedAt
        case contentType
        case contentStatus
        case contentTitle
        case contentDescription
        case contentImageUrl
        case contentBody
        case contentFavicon
        case contentDomain
        /// JSON blob: `String?` on device, JSON dict/array on the wire. The
        /// `SyncEntityMapper` shim converts between the two shapes around
        /// the Codable boundary; here we just round-trip the String form.
        case contentMetadata
        case listId
        case meetingNoteId
        case createdAt
        case updatedAt
        case deletedAt
    }

    public convenience init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        let id = try container.decode(String.self, forKey: .id)
        let userId = try container.decode(String.self, forKey: .userId)
        let typeRaw = try container.decodeIfPresent(String.self, forKey: .type) ?? ItemType.task.rawValue
        let statusRaw = try container.decodeIfPresent(String.self, forKey: .status) ?? ItemStatus.active.rawValue
        let title = try container.decode(String.self, forKey: .title)
        let source = try container.decodeIfPresent(String.self, forKey: .source) ?? "Brett"
        let dueDate = try container.decodeIfPresent(Date.self, forKey: .dueDate)
        let listId = try container.decodeIfPresent(String.self, forKey: .listId)
        let notes = try container.decodeIfPresent(String.self, forKey: .notes)
        let createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        let updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()

        self.init(
            id: id,
            userId: userId,
            type: ItemType(rawValue: typeRaw) ?? .task,
            status: ItemStatus(rawValue: statusRaw) ?? .active,
            title: title,
            source: source,
            dueDate: dueDate,
            listId: listId,
            notes: notes,
            createdAt: createdAt,
            updatedAt: updatedAt
        )

        // Apply remaining fields not handled by the convenience initializer.
        self.itemDescription = try container.decodeIfPresent(String.self, forKey: .itemDescription)
        self.sourceId = try container.decodeIfPresent(String.self, forKey: .sourceId)
        self.sourceUrl = try container.decodeIfPresent(String.self, forKey: .sourceUrl)
        self.dueDatePrecision = try container.decodeIfPresent(String.self, forKey: .dueDatePrecision)
        self.completedAt = try container.decodeIfPresent(Date.self, forKey: .completedAt)
        self.snoozedUntil = try container.decodeIfPresent(Date.self, forKey: .snoozedUntil)
        self.reminder = try container.decodeIfPresent(String.self, forKey: .reminder)
        self.recurrence = try container.decodeIfPresent(String.self, forKey: .recurrence)
        self.recurrenceRule = try container.decodeIfPresent(String.self, forKey: .recurrenceRule)
        self.brettObservation = try container.decodeIfPresent(String.self, forKey: .brettObservation)
        self.brettTakeGeneratedAt = try container.decodeIfPresent(Date.self, forKey: .brettTakeGeneratedAt)
        self.contentType = try container.decodeIfPresent(String.self, forKey: .contentType)
        self.contentStatus = try container.decodeIfPresent(String.self, forKey: .contentStatus)
        self.contentTitle = try container.decodeIfPresent(String.self, forKey: .contentTitle)
        self.contentDescription = try container.decodeIfPresent(String.self, forKey: .contentDescription)
        self.contentImageUrl = try container.decodeIfPresent(String.self, forKey: .contentImageUrl)
        self.contentBody = try container.decodeIfPresent(String.self, forKey: .contentBody)
        self.contentFavicon = try container.decodeIfPresent(String.self, forKey: .contentFavicon)
        self.contentDomain = try container.decodeIfPresent(String.self, forKey: .contentDomain)
        self.contentMetadata = try container.decodeIfPresent(String.self, forKey: .contentMetadata)
        self.meetingNoteId = try container.decodeIfPresent(String.self, forKey: .meetingNoteId)
        self.deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(userId, forKey: .userId)
        try container.encode(type, forKey: .type)
        try container.encode(status, forKey: .status)
        try container.encode(title, forKey: .title)
        try container.encode(source, forKey: .source)
        // Use `encode` (not `encodeIfPresent`) for nullable fields so nil
        // becomes JSON `null` on the wire — matches legacy NSNull behavior.
        try container.encode(itemDescription, forKey: .itemDescription)
        try container.encode(notes, forKey: .notes)
        try container.encode(sourceId, forKey: .sourceId)
        try container.encode(sourceUrl, forKey: .sourceUrl)
        try container.encode(dueDate, forKey: .dueDate)
        try container.encode(dueDatePrecision, forKey: .dueDatePrecision)
        try container.encode(completedAt, forKey: .completedAt)
        try container.encode(snoozedUntil, forKey: .snoozedUntil)
        try container.encode(reminder, forKey: .reminder)
        try container.encode(recurrence, forKey: .recurrence)
        try container.encode(recurrenceRule, forKey: .recurrenceRule)
        try container.encode(brettObservation, forKey: .brettObservation)
        try container.encode(brettTakeGeneratedAt, forKey: .brettTakeGeneratedAt)
        try container.encode(contentType, forKey: .contentType)
        try container.encode(contentStatus, forKey: .contentStatus)
        try container.encode(contentTitle, forKey: .contentTitle)
        try container.encode(contentDescription, forKey: .contentDescription)
        try container.encode(contentImageUrl, forKey: .contentImageUrl)
        try container.encode(contentBody, forKey: .contentBody)
        try container.encode(contentFavicon, forKey: .contentFavicon)
        try container.encode(contentDomain, forKey: .contentDomain)
        // `contentMetadata` is encoded here as a String (or JSON null). The
        // `SyncEntityMapper` shim post-processes the encoded payload to
        // re-parse the string back into a JSON dict/array on the wire.
        try container.encode(contentMetadata, forKey: .contentMetadata)
        try container.encode(listId, forKey: .listId)
        try container.encode(meetingNoteId, forKey: .meetingNoteId)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        // Note: `deletedAt` is intentionally NOT encoded — the legacy
        // `toServerPayload(_ item:)` did not include it on the wire.
    }
}
