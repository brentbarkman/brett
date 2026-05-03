import Foundation
import Testing
@testable import Brett

/// Pins the contract for `DayTimeline.chipLayout`, `resolveStartHour`, and
/// `resolveEndHour`. The shared bug they guard against: events that span
/// past the visible day's edges (overnight, multi-day flights, hotel
/// holds) used to render a chip positioned at the *original* start hour
/// with the *full* duration's height — so a 36-hour conference viewed on
/// its second day would render a 2160pt-tall chip starting at the
/// original start hour, completely overflowing the grid.
///
/// Clipping the event range to the selected day's window before the
/// position math fixes both the offset and the height. The visible-window
/// resolvers also clip so the start-of-day pull-down for early events
/// uses the in-day start, not the original.
@Suite("DayTimelineLayout", .tags(.views))
struct DayTimelineLayoutTests {
    private let cal = Calendar(identifier: .gregorian)
    private let hourHeight: CGFloat = 60

    // MARK: - chipLayout

    @Test func eventEntirelyInsideDayUsesUnclippedRange() {
        // 9 AM - 10 AM on the selected day. Visible window starts at 6 AM.
        let day = makeDate(year: 2026, month: 5, day: 5)
        let start = makeDate(year: 2026, month: 5, day: 5, hour: 9)
        let end = makeDate(year: 2026, month: 5, day: 5, hour: 10)

        let layout = DayTimeline.chipLayout(
            eventStart: start,
            eventEnd: end,
            selectedDate: day,
            startHour: 6,
            hourHeight: hourHeight,
            calendar: cal
        )

        // 9 AM is 3 hours past the 6 AM window start.
        #expect(layout.offset == 180)
        #expect(layout.height == 60)
    }

    @Test func multiDayEventClipsToDayStartOnFollowingDay() {
        // Conference: Mon May 4 5 PM → Wed May 6 9 AM. Viewed on Tue May 5.
        // The chip should render from 00:00 (negative offset relative to
        // the 6 AM window start) through 24:00 — the entire day.
        let mon5pm = makeDate(year: 2026, month: 5, day: 4, hour: 17)
        let wed9am = makeDate(year: 2026, month: 5, day: 6, hour: 9)
        let tue = makeDate(year: 2026, month: 5, day: 5, hour: 12)

        let layout = DayTimeline.chipLayout(
            eventStart: mon5pm,
            eventEnd: wed9am,
            selectedDate: tue,
            startHour: 0,
            hourHeight: hourHeight,
            calendar: cal
        )

        // Offset zero: the event starts at the day's 00:00 (clipped).
        #expect(layout.offset == 0)
        // Height: 24 hours * 60pt = 1440pt — the full visible day.
        #expect(layout.height == 1440)
    }

    @Test func eventEndingPastMidnightClipsToDayEnd() {
        // Late party: 10 PM Tue May 5 → 2 AM Wed May 6.
        // Viewed on Tue May 5: chip should run from 22:00 to 24:00 (4h
        // would be wrong; only 2h is in-day).
        let tue10pm = makeDate(year: 2026, month: 5, day: 5, hour: 22)
        let wed2am = makeDate(year: 2026, month: 5, day: 6, hour: 2)
        let tue = makeDate(year: 2026, month: 5, day: 5, hour: 12)

        let layout = DayTimeline.chipLayout(
            eventStart: tue10pm,
            eventEnd: wed2am,
            selectedDate: tue,
            startHour: 6,
            hourHeight: hourHeight,
            calendar: cal
        )

        // Offset = (22 - 6) * 60 = 960
        #expect(layout.offset == 960)
        // Height = 2 hours (clipped) * 60 = 120 — NOT 4 hours (240).
        // Pre-fix this would have been 240, overflowing into the next day.
        #expect(layout.height == 120)
    }

    @Test func eventStartingBeforeDayClipsToDayStart() {
        // Overnight: 10 PM Mon May 4 → 7 AM Tue May 5.
        // Viewed on Tue May 5: chip should run from 00:00 to 7:00 (NOT
        // from 22:00 with 9h height).
        let mon10pm = makeDate(year: 2026, month: 5, day: 4, hour: 22)
        let tue7am = makeDate(year: 2026, month: 5, day: 5, hour: 7)
        let tue = makeDate(year: 2026, month: 5, day: 5, hour: 12)

        let layout = DayTimeline.chipLayout(
            eventStart: mon10pm,
            eventEnd: tue7am,
            selectedDate: tue,
            startHour: 0,
            hourHeight: hourHeight,
            calendar: cal
        )

        #expect(layout.offset == 0)
        // 7 hours in-day * 60pt
        #expect(layout.height == 420)
    }

    @Test func shortEventEnforces15MinuteFloor() {
        // 5-minute event: the raw height would be 5pt, but the chip
        // floor is 15 minutes (15pt) so very-short events stay tappable.
        let day = makeDate(year: 2026, month: 5, day: 5)
        let start = makeDate(year: 2026, month: 5, day: 5, hour: 9)
        let end = makeDate(year: 2026, month: 5, day: 5, hour: 9, minute: 5)

        let layout = DayTimeline.chipLayout(
            eventStart: start,
            eventEnd: end,
            selectedDate: day,
            startHour: 6,
            hourHeight: hourHeight,
            calendar: cal
        )

        // 15min / 60min * 60pt = 15pt
        #expect(layout.height == 15)
    }

    // MARK: - resolveStartHour / resolveEndHour

    @Test func resolveStartHourPullsDownForEarlyInDayEvent() {
        // 4 AM event starts before the 6 AM default window — pull down to 4.
        let day = makeDate(year: 2026, month: 5, day: 5)
        let early = makeEvent(
            start: makeDate(year: 2026, month: 5, day: 5, hour: 4),
            end: makeDate(year: 2026, month: 5, day: 5, hour: 5)
        )

        let result = DayTimeline.resolveStartHour(
            timed: [early],
            selectedDate: day,
            calendar: cal
        )

        #expect(result == 4)
    }

    @Test func resolveStartHourClampsMultiDayEventToZero() {
        // Multi-day event starting 5 PM the previous day. On the
        // selected day it's running since midnight — the visible window
        // should pull down to 0, NOT read the original 17.
        let day = makeDate(year: 2026, month: 5, day: 5)
        let multiDay = makeEvent(
            start: makeDate(year: 2026, month: 5, day: 4, hour: 17),
            end: makeDate(year: 2026, month: 5, day: 6, hour: 9)
        )

        let result = DayTimeline.resolveStartHour(
            timed: [multiDay],
            selectedDate: day,
            calendar: cal
        )

        #expect(result == 0)
    }

    @Test func resolveEndHourReportsBaseWhenNoLateEvents() {
        let day = makeDate(year: 2026, month: 5, day: 5)
        let normal = makeEvent(
            start: makeDate(year: 2026, month: 5, day: 5, hour: 9),
            end: makeDate(year: 2026, month: 5, day: 5, hour: 10)
        )

        let result = DayTimeline.resolveEndHour(
            timed: [normal],
            selectedDate: day,
            calendar: cal
        )

        #expect(result == 23)
    }

    @Test func resolveEndHourCapsAtBaseEvenForOvernightEvent() {
        // Event runs through to 2 AM next day — clipped end is the day's
        // 24:00. The resolver caps at base (23) per the implementation
        // contract; the chip itself extends through midnight via
        // chipLayout's clipping.
        let day = makeDate(year: 2026, month: 5, day: 5)
        let overnight = makeEvent(
            start: makeDate(year: 2026, month: 5, day: 5, hour: 22),
            end: makeDate(year: 2026, month: 5, day: 6, hour: 2)
        )

        let result = DayTimeline.resolveEndHour(
            timed: [overnight],
            selectedDate: day,
            calendar: cal
        )

        #expect(result == 23)
    }

    // MARK: - helpers

    private func makeDate(
        year: Int,
        month: Int,
        day: Int,
        hour: Int = 0,
        minute: Int = 0
    ) -> Date {
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = day
        comps.hour = hour
        comps.minute = minute
        return cal.date(from: comps)!
    }

    private func makeEvent(start: Date, end: Date) -> CalendarEvent {
        CalendarEvent(
            id: UUID().uuidString,
            userId: "u1",
            googleAccountId: "ga1",
            calendarListId: "cal1",
            googleEventId: UUID().uuidString,
            title: "Event",
            startTime: start,
            endTime: end
        )
    }
}
