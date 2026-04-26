import Foundation
import Testing
@testable import Brett

/// Pins the contract for `CalendarEvent.isBusy`. Google Calendar's
/// `transparency` field travels server-side as part of the scrubbed
/// `rawGoogleEvent` JSON (see `apps/api/src/services/calendar-sync.ts`
/// `scrubRawEvent`), reaches iOS via the standard sync pull, and lands
/// in `CalendarEvent.rawGoogleEventJSON`. `isBusy` reads it.
///
/// The category of bug these tests guard against: silently counting
/// Gmail-derived flight / hotel / working-location holds in the Today
/// summary's "X meetings (Yh)" line. Those events are stored with
/// `transparency: "transparent"` upstream — anything else, including
/// no rawGoogleEvent at all, must default to busy so manually-created
/// or non-Google events keep counting.
@Suite("CalendarEvent.isBusy", .tags(.models))
struct CalendarEventTests {

    @Test func opaqueTransparencyIsBusy() {
        let event = makeEvent(rawGoogleEventJSON: #"{"transparency":"opaque"}"#)
        #expect(event.isBusy == true)
    }

    @Test func transparentTransparencyIsNotBusy() {
        let event = makeEvent(rawGoogleEventJSON: #"{"transparency":"transparent"}"#)
        #expect(event.isBusy == false)
    }

    @Test func missingRawGoogleEventDefaultsToBusy() {
        // Manually-created / non-Google events have no rawGoogleEventJSON.
        // We must keep counting them or every non-Google event silently
        // disappears from the totals.
        let event = makeEvent(rawGoogleEventJSON: nil)
        #expect(event.isBusy == true)
    }

    @Test func rawGoogleEventWithoutTransparencyKeyDefaultsToBusy() {
        let event = makeEvent(rawGoogleEventJSON: #"{"id":"abc","status":"confirmed"}"#)
        #expect(event.isBusy == true)
    }

    @Test func malformedRawGoogleEventDefaultsToBusy() {
        let event = makeEvent(rawGoogleEventJSON: "not-json")
        #expect(event.isBusy == true)
    }

    @Test func emptyStringRawGoogleEventDefaultsToBusy() {
        let event = makeEvent(rawGoogleEventJSON: "")
        #expect(event.isBusy == true)
    }

    @Test func unknownTransparencyValueDefaultsToBusy() {
        // Future-proofing: if Google introduces a third value, we'd rather
        // count it than drop it.
        let event = makeEvent(rawGoogleEventJSON: #"{"transparency":"future-value"}"#)
        #expect(event.isBusy == true)
    }

    @Test func filteringMixedListKeepsOnlyBusyEvents() {
        // The user-facing behavior the bug report cares about: feeding a
        // mixed set into `.filter { $0.isBusy }` drops the flight / hotel
        // entries and keeps the actual meetings.
        let realMeeting = makeEvent(
            title: "Sprint planning",
            rawGoogleEventJSON: #"{"transparency":"opaque"}"#
        )
        let flight = makeEvent(
            title: "Flight to SFO",
            rawGoogleEventJSON: #"{"transparency":"transparent","eventType":"fromGmail"}"#
        )
        let hotel = makeEvent(
            title: "Marriott San Francisco",
            rawGoogleEventJSON: #"{"transparency":"transparent","eventType":"fromGmail"}"#
        )
        let manualMeeting = makeEvent(title: "1:1", rawGoogleEventJSON: nil)

        let busy = [realMeeting, flight, hotel, manualMeeting].filter { $0.isBusy }

        #expect(busy.count == 2)
        #expect(busy.contains { $0.title == "Sprint planning" })
        #expect(busy.contains { $0.title == "1:1" })
    }

    private func makeEvent(
        title: String = "Event",
        rawGoogleEventJSON: String? = nil
    ) -> CalendarEvent {
        let event = CalendarEvent(
            id: UUID().uuidString,
            userId: "u1",
            googleAccountId: "ga1",
            calendarListId: "cal1",
            googleEventId: "ge1",
            title: title,
            startTime: Date(timeIntervalSince1970: 0),
            endTime: Date(timeIntervalSince1970: 3600)
        )
        event.rawGoogleEventJSON = rawGoogleEventJSON
        return event
    }
}
