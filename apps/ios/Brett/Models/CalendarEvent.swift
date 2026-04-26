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

    /// Whether this event blocks time on the user's calendar.
    ///
    /// Mirrors Google Calendar's `transparency` field: `"transparent"` means
    /// the event does not block time (e.g. Gmail-derived flight / hotel
    /// holds, working-location markers). `"opaque"` (the default) means the
    /// user is busy. Anything else — including a missing field or a non-
    /// Google event with no `rawGoogleEventJSON` — falls back to busy so we
    /// don't silently drop manually-created events from totals.
    ///
    /// The transparency value is preserved server-side in the scrubbed
    /// `rawGoogleEvent` JSON (see `apps/api/src/services/calendar-sync.ts`
    /// `scrubRawEvent`) and shipped to clients via the standard sync pull.
    var isBusy: Bool {
        guard let json = rawGoogleEventJSON,
              let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let transparency = dict["transparency"] as? String else {
            return true
        }
        return transparency != "transparent"
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
