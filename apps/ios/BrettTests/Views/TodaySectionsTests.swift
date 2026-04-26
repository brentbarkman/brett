import Testing
import Foundation
import SwiftData
@testable import Brett

/// Tests for `TodaySections.bucket(items:reflowKey:pendingDoneIDs:)`, the
/// pure value-type bucketing logic that was previously nested inside
/// `TodayPage.swift`. Extracting it to its own file made testability
/// this easy — before, exercising the rules meant rendering the view.
@Suite("TodaySections.bucket")
@MainActor
struct TodaySectionsTests {

    /// UTC calendar — must match the calendar `TodaySections.bucket()`
    /// uses internally, otherwise local-vs-UTC date math drifts and
    /// fixtures land in the wrong bucket non-deterministically by
    /// time of day the test suite runs.
    private let utcCalendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    private func makeContext() throws -> ModelContext {
        let container = try InMemoryPersistenceController.makeContainer()
        return ModelContext(container)
    }

    private func itemDue(_ date: Date?, completedAt: Date? = nil, status: ItemStatus = .active) -> Item {
        let item = Item(userId: "u1", title: "t", dueDate: date)
        item.status = status.rawValue
        item.completedAt = completedAt
        return item
    }

    @Test func itemDueYesterdayGoesToOverdue() throws {
        let ctx = try makeContext()
        let yesterday = utcCalendar.date(byAdding: .day, value: -1, to: Date())!
        let item = itemDue(yesterday)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0)

        #expect(sections.overdue.map(\.id) == [item.id])
        #expect(sections.today.isEmpty)
        #expect(sections.activeCount == 1)
    }

    @Test func itemDueTodayGoesToToday() throws {
        let ctx = try makeContext()
        let today = utcCalendar.startOfDay(for: Date()).addingTimeInterval(3600)
        let item = itemDue(today)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0)

        #expect(sections.today.map(\.id) == [item.id])
        #expect(sections.overdue.isEmpty)
    }

    @Test func itemCompletedTodayGoesToDoneToday() throws {
        let ctx = try makeContext()
        let now = Date()
        let item = itemDue(now, completedAt: now, status: .done)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0)

        #expect(sections.doneToday.map(\.id) == [item.id])
        #expect(sections.hasDoneToday)
    }

    @Test func itemCompletedYesterdayIsOmittedEntirely() throws {
        let ctx = try makeContext()
        let yesterday = utcCalendar.date(byAdding: .day, value: -1, to: Date())!
        let item = itemDue(yesterday, completedAt: yesterday, status: .done)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0)

        #expect(sections.doneToday.isEmpty)
        #expect(sections.activeCount == 0)
    }

    @Test func archivedItemsAreDropped() throws {
        let ctx = try makeContext()
        let now = Date()
        let item = itemDue(now)
        item.status = ItemStatus.archived.rawValue
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0)

        #expect(sections.activeCount == 0)
        #expect(sections.doneToday.isEmpty)
    }

    @Test func pendingDoneIdHoldsItemInActiveSection() throws {
        // After the user toggles an item done, we keep it visually in its
        // prior section (not the "Done today" bucket) until the debounce
        // expires — lets the user tap nearby rows without the list jumping.
        let ctx = try makeContext()
        let today = utcCalendar.startOfDay(for: Date()).addingTimeInterval(3600)
        let item = itemDue(today, completedAt: Date(), status: .done)
        ctx.insert(item)

        let sections = TodaySections.bucket(
            items: [item],
            reflowKey: 0,
            pendingDoneIDs: [item.id]
        )

        // Should still be in Today even though status == done.
        #expect(sections.today.map(\.id) == [item.id])
        #expect(sections.doneToday.isEmpty)
    }

    @Test func activeItemWithoutDueDateIsIgnored() throws {
        // Inbox items (no due date, active) aren't a "Today" concern —
        // they're surfaced on the Inbox page instead.
        let ctx = try makeContext()
        let item = itemDue(nil)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0)

        #expect(sections.activeCount == 0)
    }

    // MARK: - Boundary parity with desktop

    /// Fixed UTC moments used by the boundary parity tests. Date math
    /// here is fully deterministic — these tests must hold regardless of
    /// what day or hour the suite runs.
    private static func utcDate(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12) -> Date {
        var c = DateComponents()
        c.year = y; c.month = m; c.day = d; c.hour = h
        c.timeZone = TimeZone(identifier: "UTC")
        return Calendar(identifier: .gregorian).date(from: c)!
    }

    @Test func sundayDueOnSaturdayBucketsAsThisWeek() throws {
        // The exact bug we shipped against: on Saturday, a task due the
        // upcoming Sunday must land in `thisWeek` to match desktop's
        // `computeUrgency` (`packages/business/src/index.ts`), which treats
        // `dueMs <= endOfThisWeek` (Sunday midnight UTC) as inclusive.
        let ctx = try makeContext()
        let saturday = Self.utcDate(2026, 4, 25, 12)         // Sat noon UTC
        let sundayDue = Self.utcDate(2026, 4, 26, 0)         // Sun 00:00 UTC — boundary
        let item = itemDue(sundayDue)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0, now: saturday)

        #expect(sections.thisWeek.map(\.id) == [item.id])
        #expect(sections.nextWeek.isEmpty)
    }

    @Test func sundayDueLaterInDayOnSaturdayBucketsAsThisWeek() throws {
        // Same day-of-week boundary, but with a non-midnight time on the
        // due date. Desktop strips to `utcDay(dueDate)` so any moment on
        // Sunday counts as "this week" today (Saturday).
        let ctx = try makeContext()
        let saturday = Self.utcDate(2026, 4, 25, 12)
        let sundayLate = Self.utcDate(2026, 4, 26, 23)       // Sun 23:00 UTC
        let item = itemDue(sundayLate)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0, now: saturday)

        #expect(sections.thisWeek.map(\.id) == [item.id])
        #expect(sections.nextWeek.isEmpty)
    }

    @Test func mondayDueOnSaturdayBucketsAsNextWeek() throws {
        // Sanity check the upper edge — Monday must still fall to
        // `nextWeek`. Catches an over-correction (e.g. +2 days instead of
        // +1) that would also pull Monday in.
        let ctx = try makeContext()
        let saturday = Self.utcDate(2026, 4, 25, 12)
        let mondayDue = Self.utcDate(2026, 4, 27, 0)
        let item = itemDue(mondayDue)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0, now: saturday)

        #expect(sections.nextWeek.map(\.id) == [item.id])
        #expect(sections.thisWeek.isEmpty)
    }

    @Test func nextSundayDueOnSaturdayBucketsAsNextWeek() throws {
        // Desktop puts a task on the *following* Sunday into `nextWeek`
        // (`dueMs <= endOfNextWeek`, where `endOfNextWeek = endOfThisWeek
        // + 7 days`). Before parity work iOS dropped this row entirely.
        let ctx = try makeContext()
        let saturday = Self.utcDate(2026, 4, 25, 12)
        let nextSunday = Self.utcDate(2026, 5, 3, 0)
        let item = itemDue(nextSunday)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0, now: saturday)

        #expect(sections.nextWeek.map(\.id) == [item.id])
    }

    @Test func sundayTodayPutsTodayItemInTodayNotThisWeek() throws {
        // When today *is* Sunday, an item dated today must still land in
        // `today`, not `thisWeek` — verifies the `weekday == 1` branch
        // doesn't pull today's row forward.
        let ctx = try makeContext()
        let sunday = Self.utcDate(2026, 4, 26, 12)
        let sundayDue = Self.utcDate(2026, 4, 26, 18)
        let item = itemDue(sundayDue)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0, now: sunday)

        #expect(sections.today.map(\.id) == [item.id])
        #expect(sections.thisWeek.isEmpty)
    }

    @Test func sortingPutsNewestCreatedFirst() throws {
        // Within-bucket sort matches desktop's `/things` route — `createdAt
        // DESC`, with stable secondary `id`. Was previously `dueDate ASC`,
        // which produced visibly different ordering across platforms.
        let ctx = try makeContext()
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let today = cal.startOfDay(for: Date())
        let dueAt = today.addingTimeInterval(3600)
        let earlierCreated = Item(userId: "u", title: "first", source: "test", dueDate: dueAt, createdAt: today.addingTimeInterval(-7200))
        let laterCreated = Item(userId: "u", title: "second", source: "test", dueDate: dueAt, createdAt: today.addingTimeInterval(-3600))
        ctx.insert(earlierCreated)
        ctx.insert(laterCreated)

        let sections = TodaySections.bucket(items: [earlierCreated, laterCreated], reflowKey: 0)

        // Newest first — laterCreated (created -3600) should precede earlierCreated.
        #expect(sections.today.map(\.createdAt) == [laterCreated.createdAt, earlierCreated.createdAt])
    }
}
