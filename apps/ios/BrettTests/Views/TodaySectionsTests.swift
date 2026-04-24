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
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let item = itemDue(yesterday)
        ctx.insert(item)

        let sections = TodaySections.bucket(items: [item], reflowKey: 0)

        #expect(sections.overdue.map(\.id) == [item.id])
        #expect(sections.today.isEmpty)
        #expect(sections.activeCount == 1)
    }

    @Test func itemDueTodayGoesToToday() throws {
        let ctx = try makeContext()
        let today = Calendar.current.startOfDay(for: Date()).addingTimeInterval(3600)
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
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
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
        let today = Calendar.current.startOfDay(for: Date()).addingTimeInterval(3600)
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

    @Test func sortingPutsEarliestDueFirst() throws {
        let ctx = try makeContext()
        let today = Calendar.current.startOfDay(for: Date())
        let early = itemDue(today.addingTimeInterval(3600))
        let late = itemDue(today.addingTimeInterval(7200))
        ctx.insert(early)
        ctx.insert(late)

        // Input order is reversed on purpose — bucket() must re-sort by
        // dueDate ascending. Comparing on dueDate avoids mutating
        // SwiftData-managed `id` after construction (safer across
        // @Model macro quirks than explicitly overwriting the UUID).
        let sections = TodaySections.bucket(items: [late, early], reflowKey: 0)

        #expect(sections.today.map(\.dueDate) == [early.dueDate, late.dueDate])
    }
}
