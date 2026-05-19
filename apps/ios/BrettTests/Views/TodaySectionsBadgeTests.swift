import Foundation
import Testing
@testable import Brett

/// Tests for `TodaySections.badgeCount(items:now:)` — the number that
/// drives the iOS home-screen badge.
///
/// Rules under test (2026-05-18 tuning spec — must stay in lockstep with
/// desktop's `apps/desktop/src/lib/badgeCount.ts`):
///   - Always: overdue + today only
///   - Tonight items count as today (they have dueDate = today; the
///     `tonight` flag only affects sectioning, not counting)
///
/// History: before 2026-05-18 the badge also included `thisWeek` (and, on
/// weekends, `thisWeekend`). The `excludesThisWeek*` / `excludesWeekend*`
/// tests guard against regressing back to that.
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

    @Test func excludesThisWeekOnWeekday() {
        // Regression guard: before 2026-05-18 the badge included thisWeek
        // items. The spec narrowed it to overdue + today only.
        let thursday = days(1, from: Self.wednesdayNow)
        let friday = days(2, from: Self.wednesdayNow)
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: thursday),
            TestFixtures.makeItem(status: .active, dueDate: friday),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 0)
    }

    @Test func excludesThisWeekendOnWeekday() {
        // Sat/Sun from Wed land in `thisWeekend`, which is now excluded
        // from the badge unconditionally.
        let saturday = days(3, from: Self.wednesdayNow)
        let sunday = days(4, from: Self.wednesdayNow)
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: saturday),
            TestFixtures.makeItem(status: .active, dueDate: sunday),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 0)
    }

    @Test func excludesThisWeekendEvenOnSaturday() {
        // Critical regression guard: before 2026-05-18, weekend items DID
        // count once Saturday arrived. The new spec drops that — weekend
        // items only count once they're overdue or today. Sunday-from-
        // Saturday lands in `thisWeekend`, not `today`, so it stays out.
        let sunday = days(1, from: Self.saturdayNow)
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: Self.saturdayNow), // today ✓
            TestFixtures.makeItem(status: .active, dueDate: sunday),            // thisWeekend ✗
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.saturdayNow, localCalendar: calendar) == 1)
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

    // MARK: - Spec-named regression guards (2026-05-18 brett-tuning plan)
    //
    // These tests intentionally duplicate behavior already covered above. The
    // plan named these regression guards by exact identifier so future
    // reviewers grepping the plan can find them without trawling the broader
    // suite. Don't fold them back in — the explicit names are the point.

    @Test func narrowsToTodayOnly() {
        // The badge counts overdue + today (+ tonight, which is a today-day
        // item with a presentation hint) and NOTHING ELSE. If you add a new
        // bucket to TodaySections, this test must keep passing unchanged.
        let yesterday = days(-1, from: Self.wednesdayNow)
        let thursday = days(1, from: Self.wednesdayNow)         // thisWeek
        let saturday = days(3, from: Self.wednesdayNow)         // thisWeekend
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: yesterday),         // overdue ✓
            TestFixtures.makeItem(status: .active, dueDate: Self.wednesdayNow), // today ✓
            TestFixtures.makeItem(status: .active, dueDate: thursday),          // ✗
            TestFixtures.makeItem(status: .active, dueDate: saturday),          // ✗
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 2)
    }

    @Test func excludesWeekendOnWeekend() {
        // On Saturday, the upcoming Sunday is in the `thisWeekend` bucket and
        // MUST NOT count toward the badge. Before 2026-05-18, the badge added
        // `thisWeekend` on weekends — drop that, or the badge stays noisy
        // through the weekend.
        let sunday = days(1, from: Self.saturdayNow) // thisWeekend on Saturday
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: sunday),
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.saturdayNow, localCalendar: calendar) == 0)
    }

    @Test func countsTonight() {
        // Tonight items are today-day tasks with a presentation hint. They
        // render in their own section but must still count toward the badge —
        // an evening task created mid-afternoon must not silently fall off
        // the home-screen indicator.
        let item = TestFixtures.makeItem(status: .active, dueDate: Self.wednesdayNow)
        item.tonight = true
        #expect(TodaySections.badgeCount(items: [item], now: Self.wednesdayNow, localCalendar: calendar) == 1)
    }

    @Test func sumsBucketsTogetherOnWeekday() {
        let yesterday = days(-1, from: Self.wednesdayNow)
        let thursday = days(1, from: Self.wednesdayNow)
        let saturday = days(3, from: Self.wednesdayNow)
        let nextThursday = days(8, from: Self.wednesdayNow)
        let items = [
            TestFixtures.makeItem(status: .active,  dueDate: yesterday),         // overdue ✓
            TestFixtures.makeItem(status: .active,  dueDate: Self.wednesdayNow), // today ✓
            TestFixtures.makeItem(status: .active,  dueDate: thursday),          // thisWeek ✗
            TestFixtures.makeItem(status: .active,  dueDate: saturday),          // thisWeekend ✗
            TestFixtures.makeItem(status: .active,  dueDate: nextThursday),      // nextWeek ✗
            TestFixtures.makeItem(status: .done,    dueDate: Self.wednesdayNow), // ✗
            TestFixtures.makeItem(status: .snoozed, dueDate: yesterday),         // ✗
            TestFixtures.makeItem(status: .active,  dueDate: nil),               // ✗
        ]
        #expect(TodaySections.badgeCount(items: items, now: Self.wednesdayNow, localCalendar: calendar) == 2)
    }
}
