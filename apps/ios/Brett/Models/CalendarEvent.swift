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
