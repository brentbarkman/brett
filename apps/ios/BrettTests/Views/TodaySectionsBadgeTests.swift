import Foundation
import Testing
@testable import Brett

/// Tests for `TodaySections.badgeCount(items:)` — the number that drives
/// the iOS home-screen badge. Count = overdue + due today + this week,
/// excluding Next Week, completed, and archived items.
@Suite("TodaySections.badgeCount", .tags(.views))
struct TodaySectionsBadgeTests {

    /// Fixtures align to the same UTC calendar `TodaySections.bucket()`
    /// uses internally — without this, a "noon today (local)" date can
    /// land in a different UTC bucket on machines whose timezone shifts
    /// it across midnight UTC. Matches desktop's bucketing semantics.
    private let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    // MARK: - Dates

    private var startOfToday: Date { calendar.startOfDay(for: Date()) }
    private var yesterday: Date { calendar.date(byAdding: .day, value: -1, to: startOfToday)! }
    private var noonToday: Date { calendar.date(byAdding: .hour, value: 12, to: startOfToday)! }
    /// A date strictly inside "this week" but after today. Mirrors the
    /// `bucket()` formula: end-of-this-week is start-of-Monday UTC (one
    /// day past the upcoming Sunday, matching desktop's inclusive
    /// `<= endOfThisWeek` boundary). Returning one hour before that lands
    /// inside `thisWeek` on every weekday including Saturday and Sunday.
    private var laterThisWeek: Date {
        let weekday = calendar.component(.weekday, from: Date())
        let daysUntilEndOfWeek = weekday == 1 ? 8 : (9 - weekday)
        let endOfWeek = calendar.date(byAdding: .day, value: daysUntilEndOfWeek, to: startOfToday)!
        return calendar.date(byAdding: .hour, value: -1, to: endOfWeek)!
    }
    private var nextWeek: Date {
        let weekday = calendar.component(.weekday, from: Date())
        let daysUntilEndOfWeek = weekday == 1 ? 8 : (9 - weekday)
        let endOfWeek = calendar.date(byAdding: .day, value: daysUntilEndOfWeek, to: startOfToday)!
        return calendar.date(byAdding: .day, value: 2, to: endOfWeek)!
    }

    // MARK: - Cases

    @Test func emptyInputReturnsZero() {
        #expect(TodaySections.badgeCount(items: []) == 0)
    }

    @Test func countsOverdue() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: yesterday),
            TestFixtures.makeItem(status: .active, dueDate: yesterday),
        ]
        #expect(TodaySections.badgeCount(items: items) == 2)
    }

    @Test func countsToday() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: noonToday),
        ]
        #expect(TodaySections.badgeCount(items: items) == 1)
    }

    @Test func countsThisWeek() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: laterThisWeek),
        ]
        #expect(TodaySections.badgeCount(items: items) == 1)
    }

    @Test func excludesNextWeek() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: nextWeek),
        ]
        #expect(TodaySections.badgeCount(items: items) == 0)
    }

    @Test func excludesCompletedItems() {
        let items = [
            TestFixtures.makeItem(status: .done, dueDate: yesterday),
            TestFixtures.makeItem(status: .done, dueDate: noonToday),
        ]
        #expect(TodaySections.badgeCount(items: items) == 0)
    }

    @Test func excludesArchivedItems() {
        let items = [
            TestFixtures.makeItem(status: .archived, dueDate: yesterday),
        ]
        #expect(TodaySections.badgeCount(items: items) == 0)
    }

    @Test func excludesSnoozedItems() {
        // Snoozed items are hidden from the Today view until their snooze
        // expires, so the badge should match what the user sees on-screen
        // — zero contribution regardless of the due date.
        let items = [
            TestFixtures.makeItem(status: .snoozed, dueDate: yesterday),
            TestFixtures.makeItem(status: .snoozed, dueDate: noonToday),
        ]
        #expect(TodaySections.badgeCount(items: items) == 0)
    }

    @Test func excludesItemsWithoutDueDate() {
        let items = [
            TestFixtures.makeItem(status: .active, dueDate: nil),
        ]
        #expect(TodaySections.badgeCount(items: items) == 0)
    }

    @Test func sumsBucketsTogether() {
        let items = [
            TestFixtures.makeItem(status: .active,  dueDate: yesterday),
            TestFixtures.makeItem(status: .active,  dueDate: noonToday),
            TestFixtures.makeItem(status: .active,  dueDate: laterThisWeek),
            TestFixtures.makeItem(status: .active,  dueDate: nextWeek),       // excluded
            TestFixtures.makeItem(status: .done,    dueDate: noonToday),       // excluded
            TestFixtures.makeItem(status: .snoozed, dueDate: yesterday),       // excluded
            TestFixtures.makeItem(status: .active,  dueDate: nil),             // excluded
        ]
        #expect(TodaySections.badgeCount(items: items) == 3)
    }
}
