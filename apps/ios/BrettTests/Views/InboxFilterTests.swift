import Foundation
import Testing
@testable import Brett

/// Tests for the pure filter function behind the Inbox type pills.
///
/// The filter runs in `FilterType.filter(_:by:)` so it can be unit tested
/// without spinning up SwiftUI. These tests guard two things:
///   1. `.all` is a passthrough — it doesn't accidentally drop rows.
///   2. `.tasks` / `.content` partition the input by `ItemType` with no
///      overlap.
@Suite("InboxFilter", .tags(.views))
struct InboxFilterTests {

    // MARK: - Fixtures

    private func makeInboxFixtures() -> [Item] {
        [
            TestFixtures.makeItem(type: .task, title: "Task A"),
            TestFixtures.makeItem(type: .task, title: "Task B"),
            TestFixtures.makeItem(type: .content, title: "Newsletter"),
            TestFixtures.makeItem(type: .content, title: "Article"),
            TestFixtures.makeItem(type: .task, title: "Task C"),
        ]
    }

    // MARK: - .all

    @Test func allReturnsEveryItem() {
        let items = makeInboxFixtures()
        let out = FilterType.filter(items, by: .all)
        #expect(out.count == items.count)
    }

    @Test func allPreservesOrder() {
        let items = makeInboxFixtures()
        let out = FilterType.filter(items, by: .all)
        #expect(out.map(\.title) == items.map(\.title))
    }

    // MARK: - .tasks

    @Test func tasksReturnsOnlyTaskItems() {
        let items = makeInboxFixtures()
        let out = FilterType.filter(items, by: .tasks)
        #expect(out.count == 3)
        #expect(out.allSatisfy { $0.itemType == .task })
    }

    @Test func tasksPreservesRelativeOrder() {
        let items = makeInboxFixtures()
        let out = FilterType.filter(items, by: .tasks)
        #expect(out.map(\.title) == ["Task A", "Task B", "Task C"])
    }

    // MARK: - .content

    @Test func contentReturnsOnlyContentItems() {
        let items = makeInboxFixtures()
        let out = FilterType.filter(items, by: .content)
        #expect(out.count == 2)
        #expect(out.allSatisfy { $0.itemType == .content })
    }

    @Test func contentExcludesTasks() {
        let items = makeInboxFixtures()
        let out = FilterType.filter(items, by: .content)
        #expect(out.map(\.title) == ["Newsletter", "Article"])
    }

    // MARK: - Edge cases

    @Test func emptyInputReturnsEmpty() {
        #expect(FilterType.filter([], by: .all).isEmpty)
        #expect(FilterType.filter([], by: .tasks).isEmpty)
        #expect(FilterType.filter([], by: .content).isEmpty)
    }

    @Test func singleItemFiltersCorrectly() {
        let task = TestFixtures.makeItem(type: .task, title: "Solo")
        #expect(FilterType.filter([task], by: .tasks).count == 1)
        #expect(FilterType.filter([task], by: .content).isEmpty)
    }

    // MARK: - FilterType metadata

    @Test func filterTypesHaveStableOrder() {
        // Order affects how the pills render — keep the UI pinned to All/Tasks/Content.
        #expect(FilterType.allCases == [.all, .tasks, .content])
    }

    @Test func filterTypesHaveHumanTitles() {
        #expect(FilterType.all.title == "All")
        #expect(FilterType.tasks.title == "Tasks")
        #expect(FilterType.content.title == "Content")
    }
}
