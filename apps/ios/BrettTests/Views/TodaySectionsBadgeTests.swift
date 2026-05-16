import Foundation
import Testing
@testable import Brett

/// Tests for `TodaySections.badgeCount(items:now:)` — the number that
/// drives the iOS home-screen badge.
///
/// Rules under test:
///   - Always: overdue + today + thisWeek
///   - On Sat/Sun only: + thisWeekend (weekend items roll in once it IS
///     the weekend)
///
/// Anchored on fixed dates (Wednesday + Saturday) to make assertions
/// time-independent. Calendar is forced to UTC so date arithmetic agrees
/// with `TodaySections.bucket()` regardless of the host timezone.
@Suite("TodaySections.badgeCount", .tags(.views))
struct TodaySectionsBadgeTests {

    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    // MARK: - Fixed reference dates

    /// Wednesday April 15, 2026 at 12:00 UTC — mid-week anchor.
    private static let wednesdayNow: Date = {
        var c = DateComponents()
        c.year = 2026; c.month = 4; c.day = 15; c.hour = 12
        c.timeZone = TimeZone(identifier: "UTC")
        return Calendar(identifier: .gregorian).date(from: c)!
    }()

    /// Saturday April 18, 2026 at 12:00 UTC — weekend anchor.
    private static let saturdayNow: Date = {
        var c = DateComponents()
        c.year = 2026; c.month = 4; c.day = 18; c.hour = 12
        c.timeZone = TimeZone(identifier: "UTC")
        return Calendar(identifier: .gregorian).date(from: c)!
    }()

    private func days(_ n: Int, from base: Date) -> Date {
        calendar.date(byAdding: .day, value: n, to: base)!
    }

    // MARK: - Cases

    @Test func emptyInputReturnsZero() {
        #expect(TodaySections.badgeCount(items: [], now: Self.wednesdayNow, localCalendar: calendar) == 0)
    }

    @Test func countsOverdueOnWeekday() {
        let yesterday = days(-1, from: Self.wednesdayNow)
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: yesterday),
            TestFixtures.makeItem(status: .active, dueDate: yesterday),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 2)
    }

    @Test func countsTodayOnWeekday() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: Self.wednesdayNow),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 1)
    }

    @Test func countsThisWeekOnWeekday() {
        // Thu/Fri from Wed → thisWeek bucket → counted.
        let thursday = days(1, from: Self.wednesdayNow)
        let friday = days(2, from: Self.wednesdayNow)
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: thursday),
            TestFixtures.makeItem(status: .active, dueDate: friday),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 2)
    }

    @Test func excludesThisWeekendOnWeekday() {
        // The key new rule: Saturday and Sunday do NOT count toward the
        // badge while today is a weekday. Sat/Sun from Wed land in
        // `thisWeekend`, which is excluded until the weekend arrives.
        let saturday = days(3, from: Self.wednesdayNow)
        let sunday = days(4, from: Self.wednesdayNow)
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: saturday),
            TestFixtures.makeItem(status: .active, dueDate: sunday),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 0)
    }

    @Test func includesThisWeekendOnSaturday() {
        // Same Sat/Sun items, now evaluated on Saturday — they should
        // count toward the badge ("until it IS the weekend").
        let sunday = days(1, from: Self.saturdayNow)
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: Self.saturdayNow), // today urgency
            TestFixtures.makeItem(status: .active, dueDate: sunday),            // thisWeekend
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.saturdayNow, localCalendar: calendar) == 2)
    }

    @Test func excludesNextWeek() {
        // Eight days past Wed = Thu of next week — well into nextWeek.
        let eightDaysOut = days(8, from: Self.wednesdayNow)
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: eightDaysOut),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 0)
    }

    @Test func excludesCompletedItems() {
        let yesterday = days(-1, from: Self.wednesdayNow)
        let items = [
            TestFixtures.makeItem(status: .done, dueDate: yesterday),
            TestFixtures.makeItem(status: .done, dueDate: Self.wednesdayNow),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 0)
    }

    @Test func excludesArchivedItems() {
        let yesterday = days(-1, from: Self.wednesdayNow)
        let items = [
            TestFixtures.makeItem(status: .archived, dueDate: yesterday),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 0)
    }

    @Test func excludesSnoozedItems() {
        let yesterday = days(-1, from: Self.wednesdayNow)
        let items = [
            TestFixtures.makeItem(status: .snoozed, dueDate: yesterday),
            TestFixtures.makeItem(status: .snoozed, dueDate: Self.wednesdayNow),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 0)
    }

    @Test func excludesItemsWithoutDueDate() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: nil),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 0)
    }

    @Test func sumsBucketsTogetherOnWeekday() {
        let yesterday = days(-1, from: Self.wednesdayNow)
        let thursday = days(1, from: Self.wednesdayNow)
        let saturday = days(3, from: Self.wednesdayNow)
        let nextThursday = days(8, from: Self.wednesdayNow)
        let items = [
            TestFixtures.makeItem(status: .active,  dueDate: yesterday),         // overdue ✓
            TestFixtures.makeItem(status: .active,  dueDate: Self.wednesdayNow), // today ✓
            TestFixtures.makeItem(status: .active,  dueDate: thursday),          // thisWeek ✓
            TestFixtures.makeItem(status: .active,  dueDate: saturday),          // thisWeekend ✗ (weekday)
            TestFixtures.makeItem(status: .active,  dueDate: nextThursday),      // nextWeek ✗
            TestFixtures.makeItem(status: .done,    dueDate: Self.wednesdayNow), // ✗
            TestFixtures.makeItem(status: .snoozed, dueDate: yesterday),         // ✗
            TestFixtures.makeItem(status: .active,  dueDate: nil),               // ✗
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 3)
    }
}
