import Testing
import Foundation
@testable import Brett

@Suite("DateHelpers")
struct DateHelpersTests {
    /// Pin `now` and `dueDate` fixtures to fixed UTC moments so assertions
    /// don't depend on when the suite runs. Pair with the UTC `localCalendar`
    /// in each call so the "user's local today" anchor lines up with the
    /// UTC fixtures regardless of simulator TZ.
    private static func utcDate(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12) -> Date {
        var c = DateComponents()
        c.year = y; c.month = m; c.day = d; c.hour = h
        c.timeZone = TimeZone(identifier: "UTC")
        return Calendar(identifier: .gregorian).date(from: c)!
    }

    /// UTC calendar shared by every test — the helper derives the user's
    /// "today" from this calendar's TZ, so pinning it to UTC keeps the
    /// fixtures deterministic on every simulator host.
    private static let utcCal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static let saturdayNoon: Date = utcDate(2026, 4, 25, 12)

    @Test func computeUrgencyOverdue() {
        let yesterday = Self.utcDate(2026, 4, 24, 12)
        #expect(DateHelpers.computeUrgency(dueDate: yesterday, isCompleted: false, now: Self.saturdayNoon, localCalendar: Self.utcCal) == .overdue)
    }

    @Test func computeUrgencyToday() {
        // dueDate is at UTC midnight of April 25 (post-migration canonical
        // form). "now" can be any time on that calendar day in the user's TZ.
        let today = Self.utcDate(2026, 4, 25, 0)
        #expect(DateHelpers.computeUrgency(dueDate: today, isCompleted: false, now: Self.saturdayNoon, localCalendar: Self.utcCal) == .today)
    }

    @Test func computeUrgencyThisWeekend() {
        // On Saturday, the upcoming Sunday is the rest of this weekend.
        let sunday = Self.utcDate(2026, 4, 26, 0)
        #expect(DateHelpers.computeUrgency(dueDate: sunday, isCompleted: false, now: Self.saturdayNoon, localCalendar: Self.utcCal) == .thisWeekend)
    }

    @Test func computeUrgencyDone() {
        // `done` short-circuits before any date math.
        #expect(DateHelpers.computeUrgency(dueDate: Self.saturdayNoon, isCompleted: true) == .done)
    }

    @Test func computeUrgencyNoDueDate() {
        #expect(DateHelpers.computeUrgency(dueDate: nil, isCompleted: false) == .later)
    }

    // MARK: - Boundary parity with desktop

    @Test func mondayDueOnSaturdayIsThisWeek() {
        // On Saturday, the upcoming Mon-Fri workweek is `.thisWeek` — the
        // current weekend ends, the next workweek begins. Mirrors desktop
        // `computeUrgency(Mon, "day", null, SATURDAY) == "this_week"` in
        // packages/business/src/__tests__/business.test.ts.
        let mondayDue = Self.utcDate(2026, 4, 27, 0)
        #expect(DateHelpers.computeUrgency(dueDate: mondayDue, isCompleted: false, now: Self.saturdayNoon, localCalendar: Self.utcCal) == .thisWeek)
    }

    @Test func sundayAfterNextOnSaturdayIsNextWeek() {
        // Sat → +8 days = Sun May 3. Bucket: Sun is a weekend day; on Sat
        // the upcoming weekend is only +1 day (Sun Apr 26), so Sun May 3
        // overflows into `.nextWeek`. Mirrors desktop.
        let sundayDue = Self.utcDate(2026, 5, 3, 0)
        #expect(DateHelpers.computeUrgency(dueDate: sundayDue, isCompleted: false, now: Self.saturdayNoon, localCalendar: Self.utcCal) == .nextWeek)
    }

    @Test func fridayInTwoWeeksOnSaturdayIsNextWeek() {
        // Sat → +13 days = Fri May 8. The `next_week` preset on Sat stores
        // this date — it MUST land in `.nextWeek`, not `.later`. Guards the
        // widened Sat range (nextWeekEnd=13) against accidental tightening.
        let fridayDue = Self.utcDate(2026, 5, 8, 0)
        #expect(DateHelpers.computeUrgency(dueDate: fridayDue, isCompleted: false, now: Self.saturdayNoon, localCalendar: Self.utcCal) == .nextWeek)
    }

    @Test func nextSundayDueOnSundayIsThisWeekend() {
        // On Sunday, day-precision next Sunday is in the upcoming weekend pair.
        let sunday = Self.utcDate(2026, 4, 26, 12)
        let nextSundayDue = Self.utcDate(2026, 5, 3, 0)
        #expect(DateHelpers.computeUrgency(dueDate: nextSundayDue, isCompleted: false, now: sunday, localCalendar: Self.utcCal) == .thisWeekend)
    }

    @Test func formatRelativeDate() {
        // Use the UTC calendar + a UTC-midnight stored value, matching the
        // storage convention enforced by QuickScheduleTimezoneTests.
        let today = Self.utcDate(2026, 4, 25, 0)
        let tomorrow = Self.utcDate(2026, 4, 26, 0)
        let now = Self.utcDate(2026, 4, 25, 12)
        #expect(DateHelpers.formatRelativeDate(today, now: now, localCalendar: Self.utcCal) == "Today")
        #expect(DateHelpers.formatRelativeDate(tomorrow, now: now, localCalendar: Self.utcCal) == "Tomorrow")
    }

    @Test func formatTime() {
        var components = DateComponents()
        components.hour = 14
        components.minute = 30
        let date = Calendar.current.date(from: components)!
        let formatted = DateHelpers.formatTime(date)
        #expect(formatted.contains("2:30") || formatted.contains("14:30"))
    }

    // MARK: - weekdayName

    /// A stored `dueDate` is UTC midnight of the user's intended local
    /// calendar date. Formatting it in any other timezone flips the
    /// weekday near midnight (in TZs west of UTC, UTC-midnight reads as
    /// "the previous day" locally) — which is the exact bug that put a
    /// "Monday" subtext on tasks due Tuesday. Guard with a TZ-independent
    /// assertion: Tuesday-UTC-midnight must read as "Tuesday" no matter
    /// what TZ the host simulator is in.
    @Test func weekdayNameUsesUTCCalendar() {
        // 2026-05-19 is a Tuesday in UTC. A user in MDT (UTC-6) would
        // pick this date locally and the storage layer normalises it
        // to 2026-05-19T00:00Z (utcMidnightOfLocalDate). Formatting in
        // the local TZ would yield "Monday" — guard against that.
        let tuesday = Self.utcDate(2026, 5, 19, 0)
        #expect(DateHelpers.weekdayName(of: tuesday) == "Tuesday")
    }

    @Test func weekdayNameAtUTCMidnightIsStableAcrossDays() {
        // Spot-check several days of the week to make sure the formatter
        // isn't just stuck on one value.
        #expect(DateHelpers.weekdayName(of: Self.utcDate(2026, 5, 17, 0)) == "Sunday")
        #expect(DateHelpers.weekdayName(of: Self.utcDate(2026, 5, 18, 0)) == "Monday")
        #expect(DateHelpers.weekdayName(of: Self.utcDate(2026, 5, 19, 0)) == "Tuesday")
        #expect(DateHelpers.weekdayName(of: Self.utcDate(2026, 5, 23, 0)) == "Saturday")
    }
}
