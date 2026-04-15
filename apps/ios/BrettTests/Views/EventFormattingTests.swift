import Foundation
import Testing
@testable import Brett

/// Pure formatting helpers used by `DayTimeline` and `EventDetailView`.
@Suite("EventFormatting", .tags(.views))
struct EventFormattingTests {

    @Test func hourFormatsMorning() {
        #expect(DayTimeline.formatHour(0) == "12 AM")
        #expect(DayTimeline.formatHour(1) == "1 AM")
        #expect(DayTimeline.formatHour(11) == "11 AM")
    }

    @Test func hourFormatsNoonAndAfternoon() {
        #expect(DayTimeline.formatHour(12) == "12 PM")
        #expect(DayTimeline.formatHour(13) == "1 PM")
        #expect(DayTimeline.formatHour(20) == "8 PM")
        #expect(DayTimeline.formatHour(23) == "11 PM")
    }

    @Test func metaLineIncludesLocationAndDuration() {
        let event = makeEvent(
            title: "Team sync",
            start: makeDate(year: 2026, month: 4, day: 14, hour: 10, minute: 0),
            end:   makeDate(year: 2026, month: 4, day: 14, hour: 10, minute: 30),
            location: "Office"
        )
        #expect(DayTimeline.metaLine(for: event) == "Office · 30min")
    }

    @Test func metaLineFallsBackToMeetingLinkHost() {
        let event = makeEvent(
            title: "Design chat",
            start: makeDate(year: 2026, month: 4, day: 14, hour: 9, minute: 0),
            end:   makeDate(year: 2026, month: 4, day: 14, hour: 9, minute: 45),
            location: nil,
            meetingLink: "https://meet.google.com/abc-defg-hij"
        )
        #expect(DayTimeline.metaLine(for: event) == "meet.google.com · 45min")
    }

    @Test func metaLineNilWhenNoLocationNoLink() {
        let event = makeEvent(
            title: "Focus time",
            start: makeDate(year: 2026, month: 4, day: 14, hour: 14, minute: 0),
            end:   makeDate(year: 2026, month: 4, day: 14, hour: 15, minute: 0)
        )
        #expect(DayTimeline.metaLine(for: event) == nil)
    }

    @Test func displayHostStripsWwwAndScheme() {
        #expect(DayTimeline.displayHost(for: "https://www.example.com/path") == "example.com")
        #expect(DayTimeline.displayHost(for: "https://zoom.us/j/12345") == "zoom.us")
    }

    @Test func displayHostFallsBackToOriginalOnInvalid() {
        #expect(DayTimeline.displayHost(for: "zoom") == "zoom")
    }

    @Test func timeBlockForAllDayEvent() {
        let event = makeEvent(
            title: "Company offsite",
            start: makeDate(year: 2026, month: 4, day: 14, hour: 0, minute: 0),
            end:   makeDate(year: 2026, month: 4, day: 15, hour: 0, minute: 0),
            isAllDay: true
        )
        let formatted = EventDetailView.formatTimeBlock(event)
        #expect(formatted.hasPrefix("All day"))
    }

    @Test func timeBlockForTimedEventHasDateAndRange() {
        let event = makeEvent(
            title: "1:1",
            start: makeDate(year: 2026, month: 4, day: 14, hour: 10, minute: 0),
            end:   makeDate(year: 2026, month: 4, day: 14, hour: 10, minute: 30)
        )
        let formatted = EventDetailView.formatTimeBlock(event)
        #expect(formatted.contains("·"))
        #expect(formatted.contains("–"))
    }

    @Test func historyPluralsFlipAtOne() {
        let once = APIClient.MeetingHistoryResponse(
            recurringEventId: "rec-1",
            pastOccurrences: [
                .init(eventId: "e1", title: "Prior",
                      startTime: makeDate(year: 2026, month: 3, day: 14, hour: 10, minute: 0),
                      endTime: makeDate(year: 2026, month: 3, day: 14, hour: 11, minute: 0)),
            ],
            relatedItems: []
        )
        #expect(EventDetailView.formatHistory(once).hasPrefix("You've met once"))

        let twice = APIClient.MeetingHistoryResponse(
            recurringEventId: "rec-1",
            pastOccurrences: [
                .init(eventId: "e1", title: "Prior",
                      startTime: makeDate(year: 2026, month: 3, day: 14, hour: 10, minute: 0),
                      endTime: makeDate(year: 2026, month: 3, day: 14, hour: 11, minute: 0)),
                .init(eventId: "e2", title: "Older",
                      startTime: makeDate(year: 2026, month: 2, day: 14, hour: 10, minute: 0),
                      endTime: makeDate(year: 2026, month: 2, day: 14, hour: 11, minute: 0)),
            ],
            relatedItems: []
        )
        #expect(EventDetailView.formatHistory(twice).hasPrefix("You've met 2 times"))
    }

    private func makeDate(year: Int, month: Int, day: Int, hour: Int, minute: Int) -> Date {
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = day
        comps.hour = hour
        comps.minute = minute
        return Calendar(identifier: .gregorian).date(from: comps)!
    }

    private func makeEvent(
        title: String,
        start: Date,
        end: Date,
        isAllDay: Bool = false,
        location: String? = nil,
        meetingLink: String? = nil
    ) -> CalendarEvent {
        CalendarEvent(
            id: UUID().uuidString,
            userId: "u1",
            googleAccountId: "ga1",
            calendarListId: "cal1",
            googleEventId: "ge1",
            title: title,
            startTime: start,
            endTime: end,
            isAllDay: isAllDay,
            location: location,
            meetingLink: meetingLink
        )
    }
}
