import Foundation
import Testing
@testable import Brett

/// Pins the contract for `CalendarEvent.isOrganizer`. Read by the
/// timeline filters in `CalendarPage.visibleEvents`,
/// `TodayPage.todaysEvents`, and `TodayPage.nextUpcomingEvent` so a
/// user-organized event stays visible even when declined — matches
/// Google Calendar's behaviour of never hiding events you organized
/// from "Hide declined events".
///
/// The category of bug these tests guard against: events the user
/// organized (with or without other attendees) silently disappearing
/// from every list surface because of an over-broad declined filter.
@Suite("CalendarEvent.isOrganizer", .tags(.models))
struct CalendarEventOrganizerTests {

    @Test func selfTrueOrganizerIsTrue() {
        let event = makeEvent(organizerJSON: #"{"email":"you@example.com","self":true}"#)
        #expect(event.isOrganizer == true)
    }

    @Test func selfFalseOrganizerIsFalse() {
        let event = makeEvent(organizerJSON: #"{"email":"alice@example.com","self":false}"#)
        #expect(event.isOrganizer == false)
    }

    @Test func missingSelfFieldIsFalse() {
        // Google's API only includes `self: true` when it applies; a
        // missing `self` field means not me. Treat as false so a
        // declined event from a shared calendar (where organizer info
        // simply doesn't spell out `self: false`) stays hidden.
        let event = makeEvent(organizerJSON: #"{"email":"alice@example.com"}"#)
        #expect(event.isOrganizer == false)
    }

    @Test func nilOrganizerIsFalse() {
        let event = makeEvent(organizerJSON: nil)
        #expect(event.isOrganizer == false)
    }

    @Test func malformedOrganizerJSONIsFalse() {
        let event = makeEvent(organizerJSON: "not-json")
        #expect(event.isOrganizer == false)
    }

    @Test func filteringDeclinedKeepsOrganizerOwnedEvents() {
        // The user-facing behaviour the bug report cares about: feeding
        // a mixed list into a `myResponseStatus != declined || isOrganizer`
        // filter keeps the user's own declined events visible while
        // hiding declined invitations from others.
        let myDeclined = makeEvent(
            myResponseStatus: .declined,
            organizerJSON: #"{"email":"you@example.com","self":true}"#
        )
        let theirDeclined = makeEvent(
            myResponseStatus: .declined,
            organizerJSON: #"{"email":"alice@example.com","self":false}"#
        )
        let theirAccepted = makeEvent(
            myResponseStatus: .accepted,
            organizerJSON: #"{"email":"alice@example.com","self":false}"#
        )

        let visible = [myDeclined, theirDeclined, theirAccepted].filter {
            $0.myResponseStatus != CalendarRsvpStatus.declined.rawValue || $0.isOrganizer
        }

        #expect(visible.count == 2)
        #expect(visible.contains { $0.id == myDeclined.id })
        #expect(visible.contains { $0.id == theirAccepted.id })
        #expect(!visible.contains { $0.id == theirDeclined.id })
    }

    private func makeEvent(
        myResponseStatus: CalendarRsvpStatus = .needsAction,
        organizerJSON: String? = nil
    ) -> CalendarEvent {
        let event = CalendarEvent(
            id: UUID().uuidString,
            userId: "u1",
            googleAccountId: "ga1",
            calendarListId: "cal1",
            googleEventId: UUID().uuidString,
            title: "Event",
            startTime: Date(timeIntervalSince1970: 0),
            endTime: Date(timeIntervalSince1970: 3600),
            myResponseStatus: myResponseStatus
        )
        event.organizerJSON = organizerJSON
        return event
    }
}
