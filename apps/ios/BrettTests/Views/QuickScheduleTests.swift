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
    private func tuesdayAnchor() -> Date {
        var comps = DateComponents()
        comps.year = 2026
        comps.month = 4
        comps.day = 14
        comps.hour = 14
        comps.minute = 30
        return Calendar(identifier: .gregorian).date(from: comps)!
    }

    private func saturdayAnchor() -> Date {
        // Saturday, April 18, 2026 at 09:00 local — used to verify the
        // "today is Saturday → roll over to next Saturday" case.
        var comps = DateComponents()
        comps.year = 2026
        comps.month = 4
        comps.day = 18
        comps.hour = 9
        comps.minute = 0
        return Calendar(identifier: .gregorian).date(from: comps)!
    }

    private let calendar = Calendar(identifier: .gregorian)

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

    @Test("This Weekend rolls to NEXT Saturday when today is already Saturday")
    func weekendRollsWhenTodayIsSaturday() {
        let now = saturdayAnchor()
        let resolved = QuickScheduleOption.thisWeekend.resolvedDate(now: now, calendar: calendar)!
        let diff = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: resolved).day
        #expect(diff == 7, "Saturday should resolve to *next* Saturday, not today")
    }

    // MARK: - Next Week

    @Test("Next Week is now + 7 days at start of day")
    func nextWeekIsPlusSeven() {
        let now = tuesdayAnchor()
        let resolved = QuickScheduleOption.nextWeek.resolvedDate(now: now, calendar: calendar)!
        let expected = calendar.date(byAdding: .day, value: 7, to: calendar.startOfDay(for: now))!
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
