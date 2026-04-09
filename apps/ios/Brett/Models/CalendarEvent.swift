import Foundation
import SwiftData

@Model
final class CalendarEvent {
    @Attribute(.unique) var id: String
    var googleEventId: String
    var calendarId: String?
    var title: String
    var eventDescription: String?
    var location: String?
    var startTime: Date
    var endTime: Date
    var isAllDay: Bool = false
    var status: String = "confirmed"
    var myResponseStatus: String = "needsAction"
    var meetingLink: String?
    var organizerJSON: String?    // JSON string
    var attendeesJSON: String?    // JSON string
    var brettObservation: String?
    var calendarColor: String?
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    // Sync metadata
    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?

    init(
        id: String = UUID().uuidString,
        googleEventId: String = "",
        title: String,
        startTime: Date,
        endTime: Date,
        userId: String,
        location: String? = nil,
        meetingLink: String? = nil,
        isAllDay: Bool = false
    ) {
        self.id = id
        self.googleEventId = googleEventId
        self.title = title
        self.startTime = startTime
        self.endTime = endTime
        self.userId = userId
        self.location = location
        self.meetingLink = meetingLink
        self.isAllDay = isAllDay
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    var rsvpStatus: CalendarRsvpStatus { CalendarRsvpStatus(rawValue: myResponseStatus) ?? .needsAction }

    var durationMinutes: Int {
        Int(endTime.timeIntervalSince(startTime) / 60)
    }
}
