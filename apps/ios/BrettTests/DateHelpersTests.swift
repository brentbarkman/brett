import Testing
import Foundation
@testable import Brett

@Suite("DateHelpers")
struct DateHelpersTests {
    /// Pin `now` and `dueDate` fixtures to fixed UTC moments so assertions
    /// don't depend on when the suite runs — the helper is UTC-based, so
    /// `Calendar.current` fixtures drifted across UTC midnight. Same
    /// fixture style as `TodaySectionsTests` so both helpers — the
    /// section bucketer and the urgency-only helper used by detail-card
    /// colors — share a parity story.
    private static func utcDate(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12) -> Date {
        var c = DateComponents()
        c.year = y; c.month = m; c.day = d; c.hour = h
        c.timeZone = TimeZone(identifier: "UTC")
        return Calendar(identifier: .gregorian).date(from: c)!
    }

    private static let saturdayNoon: Date = utcDate(2026, 4, 25, 12)

    @Test func computeUrgencyOverdue() {
        let yesterday = Self.utcDate(2026, 4, 24, 12)
        #expect(DateHelpers.computeUrgency(dueDate: yesterday, isCompleted: false, now: Self.saturdayNoon) == .overdue)
    }

    @Test func computeUrgencyToday() {
        let laterToday = Self.utcDate(2026, 4, 25, 18)
        #expect(DateHelpers.computeUrgency(dueDate: laterToday, isCompleted: false, now: Self.saturdayNoon) == .today)
    }

    @Test func computeUrgencyThisWeek() {
        // Sunday-on-Saturday — the inclusive boundary case. Old
        // `Calendar.current` + `7 - weekday` formula collapsed this to
        // `endOfWeek == today`, dropping Sunday into `.nextWeek` and
        // diverging from desktop's `computeUrgency`.
        let sunday = Self.utcDate(2026, 4, 26, 18)
        #expect(DateHelpers.computeUrgency(dueDate: sunday, isCompleted: false, now: Self.saturdayNoon) == .thisWeek)
    }

    @Test func computeUrgencyDone() {
        // `done` short-circuits before any date math, so a stale
        // `Date()` here can't drift the result.
        #expect(DateHelpers.computeUrgency(dueDate: Self.saturdayNoon, isCompleted: true) == .done)
    }

    @Test func computeUrgencyNoDueDate() {
        #expect(DateHelpers.computeUrgency(dueDate: nil, isCompleted: false) == .later)
    }

    // MARK: - Boundary parity with desktop

    @Test func mondayDueOnSaturdayIsNextWeek() {
        // Sanity check the upper edge — Monday must still classify as
        // `.nextWeek`. Catches over-correcting the boundary by +2 days.
        let mondayDue = Self.utcDate(2026, 4, 27, 0)
        #expect(DateHelpers.computeUrgency(dueDate: mondayDue, isCompleted: false, now: Self.saturdayNoon) == .nextWeek)
    }

    @Test func nextSundayDueOnSundayIsThisWeek() {
        // On Sunday, "this week" extends a full 7 days through next
        // Sunday. Verifies the `weekday == 1` branch matches desktop.
        let sunday = Self.utcDate(2026, 4, 26, 12)
        let nextSundayDue = Self.utcDate(2026, 5, 3, 0)
        #expect(DateHelpers.computeUrgency(dueDate: nextSundayDue, isCompleted: false, now: sunday) == .thisWeek)
    }

    @Test func formatRelativeDate() {
        let today = Calendar.current.startOfDay(for: Date())
        #expect(DateHelpers.formatRelativeDate(today).contains("Today"))

        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: today)!
        #expect(DateHelpers.formatRelativeDate(tomorrow).contains("Tomorrow"))
    }

    @Test func formatTime() {
        var components = DateComponents()
        components.hour = 14
        components.minute = 30
        let date = Calendar.current.date(from: components)!
        let formatted = DateHelpers.formatTime(date)
        #expect(formatted.contains("2:30") || formatted.contains("14:30"))
    }
}
