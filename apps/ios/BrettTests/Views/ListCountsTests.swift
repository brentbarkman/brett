import Foundation
import Testing
@testable import Brett

/// Tests for the pure grouper behind `ListsPage`'s per-card counts.
///
/// `ListsPage` used to call `ItemStore.fetchAll(listId:)` once per rendered
/// card, which meant rendering N lists triggered N full-table scans of every
/// non-deleted item. The new shape fetches items once and groups them by
/// `listId` in a single pass via `ListCounts.groupByListId`. These tests
/// guard the grouping rules — they don't try to assert fetch counts, which
/// would only echo the implementation.
@Suite("ListCounts", .tags(.views))
struct ListCountsTests {

    // MARK: - Grouping

    @Test func groupsItemsByListId() {
        let items = [
            TestFixtures.makeItem(listId: "a"),
            TestFixtures.makeItem(listId: "a"),
            TestFixtures.makeItem(listId: "b"),
        ]
        let out = ListCounts.groupByListId(items)
        #expect(out["a"]?.total == 2)
        #expect(out["b"]?.total == 1)
    }

    @Test func skipsItemsWithoutAListId() {
        let items = [
            TestFixtures.makeItem(listId: nil),
            TestFixtures.makeItem(listId: nil),
            TestFixtures.makeItem(listId: "a"),
        ]
        let out = ListCounts.groupByListId(items)
        #expect(out.count == 1)
        #expect(out["a"]?.total == 1)
    }

    @Test func excludesArchivedFromEveryBucket() {
        let items = [
            TestFixtures.makeItem(status: .active, listId: "a"),
            TestFixtures.makeItem(status: .archived, listId: "a"),
            TestFixtures.makeItem(status: .archived, listId: "a"),
        ]
        let entry = ListCounts.groupByListId(items)["a"]
        #expect(entry?.active == 1)
        #expect(entry?.completed == 0)
        #expect(entry?.total == 1)
    }

    @Test func countsDoneAsCompleted() {
        let items = [
            TestFixtures.makeItem(status: .done, listId: "a"),
            TestFixtures.makeItem(status: .done, listId: "a"),
            TestFixtures.makeItem(status: .active, listId: "a"),
        ]
        let entry = ListCounts.groupByListId(items)["a"]
        #expect(entry?.active == 1)
        #expect(entry?.completed == 2)
        #expect(entry?.total == 3)
    }

    @Test func countsSnoozedAsActive() {
        // Snoozed items still belong to the progress ring's "not done
        // yet" bucket — the old `itemCounts(for:)` kept them in active
        // by filtering on `!= .done`. Regressing this would make the
        // list-card subtitle undercount open work.
        let items = [
            TestFixtures.makeItem(status: .snoozed, listId: "a"),
            TestFixtures.makeItem(status: .active, listId: "a"),
        ]
        let entry = ListCounts.groupByListId(items)["a"]
        #expect(entry?.active == 2)
        #expect(entry?.completed == 0)
        #expect(entry?.total == 2)
    }

    @Test func totalEqualsActivePlusCompleted() {
        let items = [
            TestFixtures.makeItem(status: .active, listId: "a"),
            TestFixtures.makeItem(status: .done, listId: "a"),
            TestFixtures.makeItem(status: .archived, listId: "a"),
            TestFixtures.makeItem(status: .snoozed, listId: "a"),
        ]
        let entry = ListCounts.groupByListId(items)["a"]
        #expect((entry?.active ?? 0) + (entry?.completed ?? 0) == entry?.total)
    }

    @Test func emptyInputReturnsEmptyDictionary() {
        #expect(ListCounts.groupByListId([]).isEmpty)
    }

    @Test func listsWithOnlyArchivedItemsAreAbsent() {
        // If every row on a list is archived, the grouper produces no
        // entry for that list — consumers fall back to `.empty`, which
        // renders as a zero-state progress dot rather than a spurious
        // "0 items, all done" ring.
        let items = [
            TestFixtures.makeItem(status: .archived, listId: "a"),
            TestFixtures.makeItem(status: .archived, listId: "a"),
        ]
        let out = ListCounts.groupByListId(items)
        #expect(out["a"] == nil)
    }

    @Test func emptyEntryDefaultIsAllZeros() {
        #expect(ListCounts.Entry.empty.active == 0)
        #expect(ListCounts.Entry.empty.completed == 0)
        #expect(ListCounts.Entry.empty.total == 0)
    }
}
