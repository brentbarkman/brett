import Testing
import Foundation
@testable import Brett

/// Exercises the pure-string factories in `AccessibilityLabels`. These
/// functions take value types and never touch the SwiftUI or UIAccessibility
/// globals, so we can verify their output without a view graph.
@Suite("Accessibility labels", .tags(.accessibility))
struct AccessibilityLabelsTests {
    // MARK: - Task

    @Test func taskLabelCombinesTitleDueListAndCompletion() {
        let now = Date()
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: now)!
        let item = TestFixtures.makeItem(
            status: .active,
            title: "Buy groceries",
            dueDate: tomorrow
        )
        let label = AccessibilityLabels.task(item, listName: "Shopping", now: now)
        #expect(label.contains("Buy groceries"))
        #expect(label.contains("due tomorrow"))
        #expect(label.contains("in Shopping list"))
        #expect(!label.contains("Completed"))
    }

    @Test func taskLabelOmitsOptionalSegments() {
        // No due date, no list, not completed → only the title.
        let item = TestFixtures.makeItem(title: "Read book")
        let label = AccessibilityLabels.task(item, listName: nil)
        #expect(label == "Read book")
    }

    @Test func taskLabelMarksCompletion() {
        let item = TestFixtures.makeItem(status: .done, title: "Ship release")
        let label = AccessibilityLabels.task(item, listName: nil)
        #expect(label.contains("Completed"))
    }

    @Test func taskLabelIgnoresEmptyListName() {
        let item = TestFixtures.makeItem(title: "Something")
        let label = AccessibilityLabels.task(item, listName: "")
        #expect(!label.contains(" list"))
    }

    // MARK: - Checkbox

    @Test func checkboxReadsAsActionToTake() {
        // Not-yet-done → user will complete it.
        let pending = TestFixtures.makeItem(status: .active, title: "Email boss")
        #expect(AccessibilityLabels.checkbox(pending) == "Mark Email boss complete")

        // Already done → user will un-complete it.
        let done = TestFixtures.makeItem(status: .done, title: "Email boss")
        #expect(AccessibilityLabels.checkbox(done) == "Mark Email boss incomplete")
    }

    @Test func checkboxTitleOverloadMatchesItemOverload() {
        #expect(
            AccessibilityLabels.checkbox(title: "Foo", isCompleted: false)
                == "Mark Foo complete"
        )
        #expect(
            AccessibilityLabels.checkbox(title: "Foo", isCompleted: true)
                == "Mark Foo incomplete"
        )
    }

    // MARK: - Relative day phrasing

    @Test func relativeDayPhrasing() {
        let calendar = Calendar.current
        let now = calendar.startOfDay(for: Date()).addingTimeInterval(9 * 3600) // 9am today

        #expect(AccessibilityLabels.relativeDayPhrase(for: now, now: now) == "today")

        let tomorrow = calendar.date(byAdding: .day, value: 1, to: now)!
        #expect(AccessibilityLabels.relativeDayPhrase(for: tomorrow, now: now) == "tomorrow")

        let yesterday = calendar.date(byAdding: .day, value: -1, to: now)!
        #expect(AccessibilityLabels.relativeDayPhrase(for: yesterday, now: now) == "yesterday")

        let threeDays = calendar.date(byAdding: .day, value: 3, to: now)!
        #expect(AccessibilityLabels.relativeDayPhrase(for: threeDays, now: now) == "in 3 days")

        let threeDaysAgo = calendar.date(byAdding: .day, value: -3, to: now)!
        #expect(AccessibilityLabels.relativeDayPhrase(for: threeDaysAgo, now: now) == "3 days ago")
    }

    @Test func relativeDayFallsBackToAbsoluteForDistantDates() {
        let calendar = Calendar.current
        let now = calendar.startOfDay(for: Date())
        let distant = calendar.date(byAdding: .day, value: 42, to: now)!
        let phrase = AccessibilityLabels.relativeDayPhrase(for: distant, now: now)
        // Not one of the relative forms — just require it's not empty and
        // doesn't contain "days" (to make sure we took the fallback branch).
        #expect(!phrase.isEmpty)
        #expect(!phrase.contains("days"))
    }

    // MARK: - Calendar event

    @Test func eventLabelIncludesTimeRangeAndAttendeeCount() {
        let start = Calendar.current.date(from: DateComponents(year: 2026, month: 4, day: 14, hour: 9, minute: 0))!
        let end = start.addingTimeInterval(30 * 60)
        let event = TestFixtures.makeEvent(
            title: "Team standup",
            startTime: start,
            endTime: end,
            isAllDay: false
        )
        event.attendeesJSON = """
        [{"email":"a@x.com"},{"email":"b@x.com"},{"email":"c@x.com"}]
        """
        let label = AccessibilityLabels.event(event)
        #expect(label.contains("Team standup"))
        #expect(label.contains("9:00 AM"))
        #expect(label.contains("9:30 AM"))
        #expect(label.contains("with 3 attendees"))
    }

    @Test func eventLabelSpeaksAllDay() {
        let start = Date()
        let end = start.addingTimeInterval(24 * 3600)
        let event = TestFixtures.makeEvent(
            title: "Offsite",
            startTime: start,
            endTime: end,
            isAllDay: true
        )
        let label = AccessibilityLabels.event(event)
        #expect(label.contains("Offsite"))
        #expect(label.contains("all day"))
        #expect(!label.contains("AM"))
        #expect(!label.contains("PM"))
    }

    @Test func eventLabelPluralisesAttendees() {
        let event = TestFixtures.makeEvent(title: "1:1")
        event.attendeesJSON = #"[{"email":"a@x.com"}]"#
        #expect(AccessibilityLabels.event(event).contains("with 1 attendee"))
    }

    @Test func eventLabelSkipsZeroAttendees() {
        let event = TestFixtures.makeEvent(title: "Focus time")
        event.attendeesJSON = "[]"
        let label = AccessibilityLabels.event(event)
        #expect(!label.contains("attendee"))
    }

    @Test func eventLabelIncludesLocation() {
        let event = TestFixtures.makeEvent(title: "Coffee")
        event.location = "Blue Bottle"
        #expect(AccessibilityLabels.event(event).contains("at Blue Bottle"))
    }

    // MARK: - Scout

    @Test func scoutLabelReadsNameFindingsAndStatus() {
        let scout = TestFixtures.makeScout(name: "AI news")
        let label = AccessibilityLabels.scout(scout, findingsCount: 12)
        #expect(label.contains("Watching for AI news"))
        #expect(label.contains("12 findings"))
        #expect(label.contains("active"))
    }

    @Test func scoutLabelHandlesZeroAndSingular() {
        let scout = TestFixtures.makeScout(name: "AI news")
        #expect(AccessibilityLabels.scout(scout, findingsCount: 0).contains("no findings yet"))
        #expect(AccessibilityLabels.scout(scout, findingsCount: 1).contains("1 finding"))
        // Ensure plural doesn't leak into the singular form.
        #expect(!AccessibilityLabels.scout(scout, findingsCount: 1).contains("1 findings"))
    }

    // MARK: - Finding

    @Test func findingLabelIncludesTypeTitleAndSource() {
        let finding = TestFixtures.makeFinding(
            type: .article,
            title: "New model dropped",
            sourceName: "TechCrunch"
        )
        let label = AccessibilityLabels.finding(finding)
        #expect(label.contains("Article"))
        #expect(label.contains("New model dropped"))
        #expect(label.contains("TechCrunch"))
    }

    // MARK: - Page indicator

    @Test func pageIndicatorIncludesPositionAndName() {
        #expect(
            AccessibilityLabels.pageIndicator(current: 2, total: 3, name: "Today")
                == "Today, page 2 of 3"
        )
    }

    @Test func dailyBriefingAndVoiceModeLabels() {
        #expect(!AccessibilityLabels.dailyBriefing().isEmpty)
        #expect(!AccessibilityLabels.voiceMode().isEmpty)
    }
}
