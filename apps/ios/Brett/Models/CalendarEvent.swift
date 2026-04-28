import Foundation
import SwiftData

/// Mirrors Prisma `CalendarEvent`.
@Model
final class CalendarEvent {
    // MARK: - Identity / ownership
    @Attribute(.unique) var id: String
    var userId: String

    // Google linkage
    var googleAccountId: String
    var calendarListId: String
    var googleEventId: String

    // Content
    var title: String
    var eventDescription: String?    // Prisma: description (reserved in SwiftUI list)
    var location: String?
    var startTime: Date
    var endTime: Date
    var isAllDay: Bool = false

    // Status
    var status: String = "confirmed"
    var myResponseStatus: String = CalendarRsvpStatus.needsAction.rawValue

    // Recurrence
    var recurrence: String?
    var recurringEventId: String?

    // Meetings
    var meetingLink: String?
    var conferenceId: String?
    var googleColorId: String?

    // JSON blobs (encode/decode via helpers)
    var organizerJSON: String?
    var attendeesJSON: String?
    var attachmentsJSON: String?
    var rawGoogleEventJSON: String?

    // Brett observations
    var brettObservation: String?
    var brettObservationAt: Date?
    var brettObservationHash: String?

    // Timestamps
    var syncedAt: Date = Date()
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
        googleAccountId: String,
        calendarListId: String,
        googleEventId: String,
        title: String,
        startTime: Date,
        endTime: Date,
        isAllDay: Bool = false,
        location: String? = nil,
        meetingLink: String? = nil,
        myResponseStatus: MyResponseStatus = .needsAction,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.userId = userId
        self.googleAccountId = googleAccountId
        self.calendarListId = calendarListId
        self.googleEventId = googleEventId
        self.title = title
        self.startTime = startTime
        self.endTime = endTime
        self.isAllDay = isAllDay
        self.location = location
        self.meetingLink = meetingLink
        self.myResponseStatus = myResponseStatus.rawValue
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    // MARK: - Typed helpers
    var rsvpStatus: CalendarRsvpStatus {
        CalendarRsvpStatus(rawValue: myResponseStatus) ?? .needsAction
    }

    var durationMinutes: Int {
        Int(endTime.timeIntervalSince(startTime) / 60)
    }

    var syncStatusEnum: SyncStatus {
        SyncStatus(rawValue: _syncStatus) ?? .synced
    }

    // MARK: - JSON helpers (organizer / attendees)

    /// Decoded attendees — returns [] if JSON is missing or invalid.
    var attendees: [[String: Any]] {
        guard let data = attendeesJSON?.data(using: .utf8) else { return [] }
        return (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
    }

    /// Decoded organizer object (name/email) — nil if missing.
    var organizer: [String: Any]? {
        guard let data = organizerJSON?.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}

// MARK: - Codable (sync wire format)
//
// Reserved-word remap: model property `eventDescription` ↔ wire key
// `"description"`. JSON-blob fields (`organizerJSON`, `attendeesJSON`,
// `attachmentsJSON`, `rawGoogleEventJSON`) are encoded here as `String?`
// under wire keys without the `JSON` suffix; the `SyncEntityMapper` shim
// post-processes the encoded payload (and pre-processes the inbound dict)
// to convert between the on-device String form and the wire's parsed
// JSON dict/array form.
//
// Tombstone asymmetry: `deletedAt` is decoded inbound (so hydration from
// `/sync/pull` survives soft-deleted rows) but NOT encoded outbound — the
// legacy `toServerPayload(_ event:)` did not include it on the wire.
//
// Sync-metadata fields (`_syncStatus`, `_baseUpdatedAt`, `_lastError`)
// are deliberately excluded from both directions: they are local-only
// state and must not be round-tripped through the server.
extension CalendarEvent: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case googleAccountId
        case calendarListId
        case googleEventId
        case title
        /// Swift property is `eventDescription` (avoids SwiftUI list collision)
        /// — wire key stays `"description"`.
        case eventDescription = "description"
        case location
        case startTime
        case endTime
        case isAllDay
        case status
        case myResponseStatus
        case recurrence
        case recurringEventId
        case meetingLink
        case conferenceId
        case googleColorId
        /// JSON blobs: `String?` on device, JSON dict/array on the wire. The
        /// `SyncEntityMapper` shims convert between the two shapes around
        /// the Codable boundary; here we just round-trip the String form.
        case organizerJSON = "organizer"
        case attendeesJSON = "attendees"
        case attachmentsJSON = "attachments"
        case rawGoogleEventJSON = "rawGoogleEvent"
        case brettObservation
        case brettObservationAt
        case brettObservationHash
        case syncedAt
        case createdAt
        case updatedAt
        case deletedAt
    }

    public convenience init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Decode init params.
        let id = try container.decode(String.self, forKey: .id)
        let userId = try container.decode(String.self, forKey: .userId)
        let googleAccountId = try container.decode(String.self, forKey: .googleAccountId)
        let calendarListId = try container.decode(String.self, forKey: .calendarListId)
        let googleEventId = try container.decode(String.self, forKey: .googleEventId)
        let title = try container.decode(String.self, forKey: .title)
        let startTime = try container.decode(Date.self, forKey: .startTime)
        let endTime = try container.decode(Date.self, forKey: .endTime)
        let isAllDay = try container.decodeIfPresent(Bool.self, forKey: .isAllDay) ?? false
        let location = try container.decodeIfPresent(String.self, forKey: .location)
        let meetingLink = try container.decodeIfPresent(String.self, forKey: .meetingLink)
        let myResponseStatusRaw = try container.decodeIfPresent(String.self, forKey: .myResponseStatus)
            ?? CalendarRsvpStatus.needsAction.rawValue
        let createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        let updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()

        self.init(
            id: id,
            userId: userId,
            googleAccountId: googleAccountId,
            calendarListId: calendarListId,
            googleEventId: googleEventId,
            title: title,
            startTime: startTime,
            endTime: endTime,
            isAllDay: isAllDay,
            location: location,
            meetingLink: meetingLink,
            myResponseStatus: MyResponseStatus(rawValue: myResponseStatusRaw) ?? .needsAction,
            createdAt: createdAt,
            updatedAt: updatedAt
        )

        // Apply remaining fields the convenience initializer doesn't take.
        self.eventDescription = try container.decodeIfPresent(String.self, forKey: .eventDescription)
        if let status = try container.decodeIfPresent(String.self, forKey: .status) {
            self.status = status
        }
        self.recurrence = try container.decodeIfPresent(String.self, forKey: .recurrence)
        self.recurringEventId = try container.decodeIfPresent(String.self, forKey: .recurringEventId)
        self.conferenceId = try container.decodeIfPresent(String.self, forKey: .conferenceId)
        self.googleColorId = try container.decodeIfPresent(String.self, forKey: .googleColorId)
        self.organizerJSON = try container.decodeIfPresent(String.self, forKey: .organizerJSON)
        self.attendeesJSON = try container.decodeIfPresent(String.self, forKey: .attendeesJSON)
        self.attachmentsJSON = try container.decodeIfPresent(String.self, forKey: .attachmentsJSON)
        self.rawGoogleEventJSON = try container.decodeIfPresent(String.self, forKey: .rawGoogleEventJSON)
        self.brettObservation = try container.decodeIfPresent(String.self, forKey: .brettObservation)
        self.brettObservationAt = try container.decodeIfPresent(Date.self, forKey: .brettObservationAt)
        self.brettObservationHash = try container.decodeIfPresent(String.self, forKey: .brettObservationHash)
        if let syncedAt = try container.decodeIfPresent(Date.self, forKey: .syncedAt) {
            self.syncedAt = syncedAt
        }
        self.deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Required fields.
        try container.encode(id, forKey: .id)
        try container.encode(userId, forKey: .userId)
        try container.encode(googleAccountId, forKey: .googleAccountId)
        try container.encode(calendarListId, forKey: .calendarListId)
        try container.encode(googleEventId, forKey: .googleEventId)
        try container.encode(title, forKey: .title)
        try container.encode(startTime, forKey: .startTime)
        try container.encode(endTime, forKey: .endTime)
        try container.encode(isAllDay, forKey: .isAllDay)
        try container.encode(status, forKey: .status)
        try container.encode(myResponseStatus, forKey: .myResponseStatus)
        // Use `encode` (not `encodeIfPresent`) for nullable fields so nil
        // becomes JSON `null` on the wire — matches legacy NSNull behavior.
        try container.encode(eventDescription, forKey: .eventDescription)
        try container.encode(location, forKey: .location)
        try container.encode(recurrence, forKey: .recurrence)
        try container.encode(recurringEventId, forKey: .recurringEventId)
        try container.encode(meetingLink, forKey: .meetingLink)
        try container.encode(conferenceId, forKey: .conferenceId)
        try container.encode(googleColorId, forKey: .googleColorId)
        // JSON-blob fields are encoded here as Strings (or JSON null). The
        // `SyncEntityMapper` shim post-processes the encoded payload to
        // re-parse each blob string back into a JSON dict/array on the wire.
        try container.encode(organizerJSON, forKey: .organizerJSON)
        try container.encode(attendeesJSON, forKey: .attendeesJSON)
        try container.encode(attachmentsJSON, forKey: .attachmentsJSON)
        try container.encode(rawGoogleEventJSON, forKey: .rawGoogleEventJSON)
        try container.encode(brettObservation, forKey: .brettObservation)
        try container.encode(brettObservationAt, forKey: .brettObservationAt)
        try container.encode(brettObservationHash, forKey: .brettObservationHash)
        try container.encode(syncedAt, forKey: .syncedAt)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        // Note: `deletedAt` is intentionally NOT encoded — the legacy
        // `toServerPayload(_ event:)` did not include it on the wire.
    }
}

/// Mirrors Prisma `CalendarEventNote`. One per (event, user) pair; note content is user-owned.
@Model
final class CalendarEventNote {
    @Attribute(.unique) var id: String
    var calendarEventId: String
    var userId: String
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
        calendarEventId: String,
        userId: String,
        content: String,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.calendarEventId = calendarEventId
        self.userId = userId
        self.content = content
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

// MARK: - Codable (sync wire format)
//
// The pilot for the SyncEntityMapper Codable migration. Encoding/decoding is
// asymmetric on purpose: outbound payloads (`encode(to:)`) intentionally OMIT
// `deletedAt` to match the legacy `toServerPayload(_ note:)` shape — the
// server treats note deletes via the global `/sync/push` `deletes[]` envelope,
// not a per-row tombstone. Inbound (`init(from:)`) DOES read `deletedAt` so
// hydration from `/sync/pull` survives soft-deleted rows.
//
// Sync-metadata fields (`_syncStatus`, `_baseUpdatedAt`, `_lastError`) are
// deliberately excluded from both directions: they are local-only state and
// must not be round-tripped through the server.
extension CalendarEventNote: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case calendarEventId
        case userId
        case content
        case createdAt
        case updatedAt
        case deletedAt
    }

    public convenience init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let calendarEventId = try container.decode(String.self, forKey: .calendarEventId)
        let userId = try container.decode(String.self, forKey: .userId)
        let content = try container.decode(String.self, forKey: .content)
        let createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        let updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()

        self.init(
            id: id,
            calendarEventId: calendarEventId,
            userId: userId,
            content: content,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
        self.deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(calendarEventId, forKey: .calendarEventId)
        try container.encode(userId, forKey: .userId)
        try container.encode(content, forKey: .content)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        // Note: `deletedAt` is intentionally NOT encoded — the legacy
        // `toServerPayload(_ note:)` did not include it on the wire.
    }
}
