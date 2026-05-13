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

    @Test func sundayDueOnSaturdayBucketsAsThisWeekend() throws {
        // On Saturday, the upcoming Sunday is the second day of the
        // current weekend — must land in `thisWeekend`, not `thisWeek`.
        // Mirrors desktop's `computeUrgency` returning "this_weekend".
        let ctx = try makeContext()
        let saturday = Self.utcDate(2026, 4, 25, 12)         // Sat noon UTC
        let sundayDue = Self.utcDate(2026, 4, 26, 0)         // Sun 00:00 UTC — boundary
        let item = itemDue(sundayDue)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0, now: saturday)

        #expect(sections.thisWeekend.map(\.id) == [item.id])
        #expect(sections.thisWeek.isEmpty)
        #expect(sections.nextWeek.isEmpty)
    }

    @Test func sundayDueLaterInDayOnSaturdayBucketsAsThisWeekend() throws {
        // Same day-of-week boundary, non-midnight time. `bucket()` strips
        // to start-of-day before comparing day-of-week, so any moment on
        // Sunday classifies as `thisWeekend` when today is Saturday.
        let ctx = try makeContext()
        let saturday = Self.utcDate(2026, 4, 25, 12)
        let sundayLate = Self.utcDate(2026, 4, 26, 23)       // Sun 23:00 UTC
        let item = itemDue(sundayLate)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0, now: saturday)

        #expect(sections.thisWeekend.map(\.id) == [item.id])
        #expect(sections.thisWeek.isEmpty)
    }

    @Test func mondayDueOnSaturdayBucketsAsThisWeek() throws {
        // On Saturday, the upcoming Mon-Fri is treated as "this week" —
        // the next workweek begins after the current weekend ends.
        let ctx = try makeContext()
        let saturday = Self.utcDate(2026, 4, 25, 12)
        let mondayDue = Self.utcDate(2026, 4, 27, 0)
        let item = itemDue(mondayDue)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0, now: saturday)

        #expect(sections.thisWeek.map(\.id) == [item.id])
        #expect(sections.thisWeekend.isEmpty)
        #expect(sections.nextWeek.isEmpty)
    }

    @Test func nextSundayDueOnSaturdayBucketsAsNextWeek() throws {
        // The Sunday a week from this Saturday — falls past `thisWeekend`
        // (which is today + tomorrow only on Saturday) and into `nextWeek`.
        let ctx = try makeContext()
        let saturday = Self.utcDate(2026, 4, 25, 12)
        let nextSunday = Self.utcDate(2026, 5, 3, 0)
        let item = itemDue(nextSunday)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0, now: saturday)

        #expect(sections.nextWeek.map(\.id) == [item.id])
        #expect(sections.thisWeekend.isEmpty)
    }

    @Test func sundayTodayPutsTodayItemInTodayNotElsewhere() throws {
        // When today *is* Sunday, an item dated today must still land in
        // `today`, not in `thisWeekend` or `thisWeek` — `today` urgency
        // takes precedence in the bucket switch.
        let ctx = try makeContext()
        let sunday = Self.utcDate(2026, 4, 26, 12)
        let sundayDue = Self.utcDate(2026, 4, 26, 18)
        let item = itemDue(sundayDue)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0, now: sunday)

        #expect(sections.today.map(\.id) == [item.id])
        #expect(sections.thisWeek.isEmpty)
        #expect(sections.thisWeekend.isEmpty)
    }

    @Test func saturdayDueOnWednesdayBucketsAsThisWeekend() throws {
        // Mid-week reference. Sat & Sun of this week are the `thisWeekend`
        // bucket — splitting them out from `thisWeek` (which is Mon-Fri).
        let ctx = try makeContext()
        let wednesday = Self.utcDate(2026, 4, 22, 12)
        let saturdayDue = Self.utcDate(2026, 4, 25, 0)
        let sundayDue = Self.utcDate(2026, 4, 26, 0)
        let sat = itemDue(saturdayDue)
        let sun = itemDue(sundayDue)
        ctx.insert(sat); ctx.insert(sun)

        let sections = TodaySections.bucket(items: [sat, sun], reflowKey: 0, now: wednesday)

        #expect(Set(sections.thisWeekend.map(\.id)) == Set([sat.id, sun.id]))
        #expect(sections.thisWeek.isEmpty)
    }

    @Test func fridayDueOnWednesdayBucketsAsThisWeek() throws {
        // Mid-week weekday → still in `thisWeek` under the new split.
        let ctx = try makeContext()
        let wednesday = Self.utcDate(2026, 4, 22, 12)
        let fridayDue = Self.utcDate(2026, 4, 24, 0)
        let item = itemDue(fridayDue)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0, now: wednesday)

        #expect(sections.thisWeek.map(\.id) == [item.id])
        #expect(sections.thisWeekend.isEmpty)
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
