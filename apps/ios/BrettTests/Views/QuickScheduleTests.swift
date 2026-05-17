import Foundation
import Testing
@testable import Brett

/// Pins the date arithmetic that powers the Quick-Schedule sheet. Each
/// preset resolves `now` (+ calendar) into a concrete date; if one of
/// these drifts, the UI will silently schedule into the wrong bucket.
@Suite("QuickSchedule", .tags(.views))
struct QuickScheduleTests {

    // MARK: - Helpers

    /// Tuesday, April 14, 2026 at 14:30 local time. Picked to give a
    /// predictable mid-week anchor — not a weekend, not the last day of
    /// the month, and deterministic. Today's date lines up with the
    /// CLAUDE.md project anchor so the test reads naturally against the
    /// rest of the session context.
    /// Anchor built in the same calendar as the test runner. Pinning to UTC
    /// keeps the test deterministic across simulator host timezones and
    /// matches the storage convention asserted by
    /// `QuickScheduleTimezoneTests` (UTC midnight of local calendar date).
    private func anchor(year: Int, month: Int, day: Int, hour: Int = 12) -> Date {
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = day
        comps.hour = hour
        comps.minute = 0
        comps.timeZone = TimeZone(identifier: "UTC")
        return Calendar(identifier: .gregorian).date(from: comps)!
    }

    private func tuesdayAnchor() -> Date { anchor(year: 2026, month: 4, day: 14) }
    private func saturdayAnchor() -> Date { anchor(year: 2026, month: 4, day: 18) }
    private func sundayAnchor() -> Date  { anchor(year: 2026, month: 4, day: 19) }

    /// All preset math runs in UTC so the test is the same on every host.
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    // MARK: - Today

    @Test("Today resolves to start of the supplied reference date")
    func todayIsStartOfDay() {
        let now = tuesdayAnchor()
        let resolved = QuickScheduleOption.today.resolvedDate(now: now, calendar: calendar)!
        #expect(calendar.isDate(resolved, inSameDayAs: now))
        let comps = calendar.dateComponents([.hour, .minute, .second], from: resolved)
        #expect(comps.hour == 0 && comps.minute == 0 && comps.second == 0)
    }

    // MARK: - Tomorrow

    @Test("Tomorrow is now + 1 day, at start of day")
    func tomorrowIsPlusOneDay() {
        let now = tuesdayAnchor()
        let resolved = QuickScheduleOption.tomorrow.resolvedDate(now: now, calendar: calendar)!
        let expected = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))!
        #expect(resolved == expected)
    }

    // MARK: - This Weekend

    @Test("This Weekend resolves to the next Saturday when today is mid-week")
    func weekendPicksNextSaturday() {
        let now = tuesdayAnchor() // Tuesday 2026-04-14
        let resolved = QuickScheduleOption.thisWeekend.resolvedDate(now: now, calendar: calendar)!
        // April 18, 2026 is a Saturday.
        let weekday = calendar.component(.weekday, from: resolved)
        #expect(weekday == 7) // Saturday
        let diff = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: resolved).day
        #expect(diff == 4, "Tue → Sat is 4 days away")
    }

    @Test("This Weekend resolves to today when today is already Saturday")
    func weekendIsTodayWhenSaturday() {
        let now = saturdayAnchor()
        let resolved = QuickScheduleOption.thisWeekend.resolvedDate(now: now, calendar: calendar)!
        #expect(calendar.isDate(resolved, inSameDayAs: now), "Saturday should resolve to today — we ARE in the weekend")
        let diff = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: resolved).day
        #expect(diff == 0)
    }

    @Test("This Weekend resolves to today when today is Sunday")
    func weekendIsTodayWhenSunday() {
        let now = sundayAnchor()
        let resolved = QuickScheduleOption.thisWeekend.resolvedDate(now: now, calendar: calendar)!
        #expect(calendar.isDate(resolved, inSameDayAs: now), "Sunday should resolve to today — we ARE in the weekend")
        let diff = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: resolved).day
        #expect(diff == 0)
    }

    // MARK: - This Week

    @Test("This Week is the upcoming Friday (day-precision), matching desktop semantics")
    func thisWeekIsUpcomingFriday() {
        let now = tuesdayAnchor() // Tuesday Apr 14, 2026
        let resolved = QuickScheduleOption.thisWeek.resolvedDate(now: now, calendar: calendar)!
        // Tue + 3 days = Fri Apr 17.
        let expected = calendar.date(byAdding: .day, value: 3, to: calendar.startOfDay(for: now))!
        #expect(resolved == expected)
        #expect(QuickScheduleOption.thisWeek.precision == .day)
    }

    // MARK: - Next Week

    @Test("Next Week is the Friday after This Week's Friday (matches desktop)")
    func nextWeekIsNextFriday() {
        let now = tuesdayAnchor() // Tuesday Apr 14, 2026
        let resolved = QuickScheduleOption.nextWeek.resolvedDate(now: now, calendar: calendar)!
        // This Week stores Fri Apr 17; Next Week stores Fri Apr 24.
        let expected = calendar.date(byAdding: .day, value: 10, to: calendar.startOfDay(for: now))!
        #expect(resolved == expected)
        #expect(QuickScheduleOption.nextWeek.precision == .day)
    }

    // MARK: - Next Month

    @Test("Next Month is the 1st of the upcoming calendar month")
    func nextMonthIsFirstOfNextMonth() {
        let now = tuesdayAnchor() // Tuesday Apr 14, 2026
        let resolved = QuickScheduleOption.nextMonth.resolvedDate(now: now, calendar: calendar)!
        let expected = anchor(year: 2026, month: 5, day: 1, hour: 0)
        #expect(resolved == expected)
    }

    // MARK: - In a Month

    @Test("In a Month is now + 30 days at start of day")
    func inAMonthIsPlusThirty() {
        let now = tuesdayAnchor()
        let resolved = QuickScheduleOption.inAMonth.resolvedDate(now: now, calendar: calendar)!
        let expected = calendar.date(byAdding: .day, value: 30, to: calendar.startOfDay(for: now))!
        #expect(resolved == expected)
    }

    // MARK: - Someday

    @Test("Someday resolves to nil (clears dueDate)")
    func somedayIsNil() {
        let resolved = QuickScheduleOption.someday.resolvedDate(now: tuesdayAnchor(), calendar: calendar)
        #expect(resolved == nil)
    }

    // MARK: - Pick Date

    @Test("Pick Date resolves to nil — the sheet's DatePicker supplies the value instead")
    func pickDateIsNil() {
        let resolved = QuickScheduleOption.pickDate.resolvedDate(now: tuesdayAnchor(), calendar: calendar)
        #expect(resolved == nil)
    }

    // MARK: - Display metadata

    @Test("Someday is the only muted option — all others render with the gold tint")
    func mutedVsGold() {
        for option in QuickScheduleOption.allCases {
            if option == .someday {
                #expect(option.isMuted)
            } else {
                #expect(!option.isMuted)
            }
        }
    }
}

// MARK: - Timezone-sensitive behaviour
//
// Pins the iOS picker against the user-reported "Friday 9:43 PM MT" bug —
// the point in the day when the user's LOCAL calendar date (Friday) and
// the UTC calendar date (Saturday) disagree. Every preset and every reader
// must agree on the user's *local* day, otherwise tasks land in the wrong
// bucket and the detail-panel label disagrees with the section header.
//
// Storage convention enforced by these tests: `dueDate` is always encoded
// as **UTC midnight of the user's intended local calendar date** — e.g.,
// Saturday May 16 → `2026-05-16T00:00:00.000Z`. This is what makes the
// calendar date timezone-stable and parity-able with desktop.

@Suite("QuickSchedule timezone", .tags(.views, .dates))
struct QuickScheduleTimezoneTests {

    // MARK: - Helpers

    /// Calendar pinned to a specific IANA timezone. Tests must NOT rely on
    /// the simulator's system timezone — it varies between machines.
    private func calendar(in tz: String) -> Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: tz)!
        return cal
    }

    /// Friday 2026-05-15 at 21:43 MDT == Saturday 2026-05-16 at 03:43 UTC.
    /// The exact moment the user reported the bug: their local clock still
    /// reads Friday but `Date().getUTCDate()` answers Saturday.
    private let fridayEveningMDT: Date = ISO8601DateFormatter().date(from: "2026-05-16T03:43:00Z")!

    /// Monday 2026-05-18 at 01:00 JST == Sunday 2026-05-17 at 16:00 UTC.
    /// Tokyo crosses midnight earlier than UTC — the mirror-image of MDT.
    private let mondayMorningJST: Date = ISO8601DateFormatter().date(from: "2026-05-17T16:00:00Z")!

    private func isoUTC(_ d: Date) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fmt.string(from: d)
    }

    // MARK: - The user's reported bug (Friday 21:43 MDT)

    @Test("Today on Friday-evening MDT resolves to the user's local Friday, not UTC's Saturday")
    func todayUsesLocalCalendarDate() {
        let cal = calendar(in: "America/Denver")
        let resolved = QuickScheduleOption.today.resolvedDate(now: fridayEveningMDT, calendar: cal)!
        #expect(isoUTC(resolved) == "2026-05-15T00:00:00.000Z")
    }

    @Test("Tomorrow on Friday-evening MDT resolves to Saturday May 16")
    func tomorrowUsesLocalCalendarDate() {
        let cal = calendar(in: "America/Denver")
        let resolved = QuickScheduleOption.tomorrow.resolvedDate(now: fridayEveningMDT, calendar: cal)!
        #expect(isoUTC(resolved) == "2026-05-16T00:00:00.000Z")
    }

    @Test("This Weekend on Friday-evening MDT resolves to the upcoming Saturday May 16 (not 'today')")
    func thisWeekendDoesNotCollapseOntoToday() {
        let cal = calendar(in: "America/Denver")
        let resolved = QuickScheduleOption.thisWeekend.resolvedDate(now: fridayEveningMDT, calendar: cal)!
        #expect(isoUTC(resolved) == "2026-05-16T00:00:00.000Z")
    }

    @Test("This Week on Friday-evening MDT resolves to today (Fri May 15, day-precision)")
    func thisWeekMatchesDesktop() {
        let cal = calendar(in: "America/Denver")
        let resolved = QuickScheduleOption.thisWeek.resolvedDate(now: fridayEveningMDT, calendar: cal)!
        // Friday IS this week's Friday — collapses onto today.
        #expect(isoUTC(resolved) == "2026-05-15T00:00:00.000Z")
        #expect(QuickScheduleOption.thisWeek.precision == .day)
    }

    @Test("Next Week on Friday-evening MDT resolves to next Friday May 22 (matches desktop)")
    func nextWeekMatchesDesktop() {
        let cal = calendar(in: "America/Denver")
        let resolved = QuickScheduleOption.nextWeek.resolvedDate(now: fridayEveningMDT, calendar: cal)!
        // Post-migration: both clients store Friday-anchored day-precision.
        // Friday May 15 → next Friday is May 22.
        #expect(isoUTC(resolved) == "2026-05-22T00:00:00.000Z")
    }

    // MARK: - East-of-UTC parity

    @Test("Today in Tokyo just after midnight resolves to the new local date, not UTC's previous date")
    func tokyoTodayUsesLocalCalendarDate() {
        let cal = calendar(in: "Asia/Tokyo")
        let resolved = QuickScheduleOption.today.resolvedDate(now: mondayMorningJST, calendar: cal)!
        // Locally Monday May 18 in Tokyo. UTC says Sunday May 17.
        #expect(isoUTC(resolved) == "2026-05-18T00:00:00.000Z")
    }

    @Test("This Weekend in Tokyo on Monday morning resolves to upcoming Saturday May 23")
    func tokyoThisWeekendPicksNextSaturday() {
        let cal = calendar(in: "Asia/Tokyo")
        let resolved = QuickScheduleOption.thisWeekend.resolvedDate(now: mondayMorningJST, calendar: cal)!
        #expect(isoUTC(resolved) == "2026-05-23T00:00:00.000Z")
    }

    // MARK: - Storage convention: always UTC midnight

    @Test("Every resolved preset is at UTC midnight (00:00:00.000Z) of the intended local date")
    func resolvedDatesAreUtcMidnight() {
        let cal = calendar(in: "America/Denver")
        let presets: [QuickScheduleOption] = [.today, .tomorrow, .thisWeekend, .thisWeek, .nextWeek, .nextMonth, .inAMonth]
        let utcCal: Calendar = {
            var c = Calendar(identifier: .gregorian)
            c.timeZone = TimeZone(identifier: "UTC")!
            return c
        }()
        for preset in presets {
            guard let d = preset.resolvedDate(now: fridayEveningMDT, calendar: cal) else { continue }
            let comps = utcCal.dateComponents([.hour, .minute, .second, .nanosecond], from: d)
            #expect(comps.hour == 0, "\(preset) — hour should be 0 UTC")
            #expect(comps.minute == 0, "\(preset) — minute should be 0 UTC")
            #expect(comps.second == 0, "\(preset) — second should be 0 UTC")
        }
    }

    // MARK: - Cross-platform parity fixture
    //
    // Mirrors the TypeScript fixture in
    // packages/business/src/__tests__/timezone.test.ts. If a row produces
    // a different value on either platform, the two clients drift and a
    // round-trip via sync produces visibly wrong dates.

    struct Row: Sendable {
        let nowISO: String
        let tz: String
        let preset: QuickScheduleOption
        let expectedISO: String
    }

    static let fixtures: [Row] = [
        // Friday 21:43 MDT — local Fri, UTC Sat.
        Row(nowISO: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: .today,       expectedISO: "2026-05-15T00:00:00.000Z"),
        Row(nowISO: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: .tomorrow,    expectedISO: "2026-05-16T00:00:00.000Z"),
        Row(nowISO: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: .thisWeekend, expectedISO: "2026-05-16T00:00:00.000Z"),
        // Friday → this_week stores today (Fri); next_week stores next Friday (+7).
        Row(nowISO: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: .thisWeek,    expectedISO: "2026-05-15T00:00:00.000Z"),
        Row(nowISO: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: .nextWeek,    expectedISO: "2026-05-22T00:00:00.000Z"),
        Row(nowISO: "2026-05-16T03:43:00Z", tz: "America/Denver", preset: .nextMonth,   expectedISO: "2026-06-01T00:00:00.000Z"),

        // Tuesday 14:30 PDT.
        Row(nowISO: "2026-05-19T21:30:00Z", tz: "America/Los_Angeles", preset: .today,       expectedISO: "2026-05-19T00:00:00.000Z"),
        Row(nowISO: "2026-05-19T21:30:00Z", tz: "America/Los_Angeles", preset: .thisWeekend, expectedISO: "2026-05-23T00:00:00.000Z"),
        // Tue → this_week stores this Fri (+3 = May 22); next_week stores +10 = May 29.
        Row(nowISO: "2026-05-19T21:30:00Z", tz: "America/Los_Angeles", preset: .thisWeek,    expectedISO: "2026-05-22T00:00:00.000Z"),
        Row(nowISO: "2026-05-19T21:30:00Z", tz: "America/Los_Angeles", preset: .nextWeek,    expectedISO: "2026-05-29T00:00:00.000Z"),

        // Monday 01:00 JST.
        Row(nowISO: "2026-05-17T16:00:00Z", tz: "Asia/Tokyo", preset: .today,       expectedISO: "2026-05-18T00:00:00.000Z"),
        Row(nowISO: "2026-05-17T16:00:00Z", tz: "Asia/Tokyo", preset: .thisWeekend, expectedISO: "2026-05-23T00:00:00.000Z"),
        // Mon → this Fri (+4 = May 22); next Fri (+11 = May 29).
        Row(nowISO: "2026-05-17T16:00:00Z", tz: "Asia/Tokyo", preset: .thisWeek,    expectedISO: "2026-05-22T00:00:00.000Z"),
        Row(nowISO: "2026-05-17T16:00:00Z", tz: "Asia/Tokyo", preset: .nextWeek,    expectedISO: "2026-05-29T00:00:00.000Z"),

        // UTC midday baseline — Friday Mar 13.
        Row(nowISO: "2026-03-13T12:00:00Z", tz: "UTC", preset: .today,        expectedISO: "2026-03-13T00:00:00.000Z"),
        Row(nowISO: "2026-03-13T12:00:00Z", tz: "UTC", preset: .thisWeekend,  expectedISO: "2026-03-14T00:00:00.000Z"),
        Row(nowISO: "2026-03-13T12:00:00Z", tz: "UTC", preset: .thisWeek,     expectedISO: "2026-03-13T00:00:00.000Z"),
        Row(nowISO: "2026-03-13T12:00:00Z", tz: "UTC", preset: .nextWeek,     expectedISO: "2026-03-20T00:00:00.000Z"),
    ]

    @Test("cross-platform parity fixture", arguments: QuickScheduleTimezoneTests.fixtures)
    func crossPlatformParity(row: Row) {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: row.tz)!
        let now = ISO8601DateFormatter().date(from: row.nowISO)!
        let resolved = row.preset.resolvedDate(now: now, calendar: cal)!
        #expect(isoUTC(resolved) == row.expectedISO)
    }
}
