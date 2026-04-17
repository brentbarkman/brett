import Foundation
import Testing
@testable import Brett

/// Covers the omnibar's natural-language parser — list tag extraction,
/// relative / absolute date parsing, time composition, and task / event /
/// question classification. The parser runs on every keystroke's submit,
/// so regressions here would corrupt every captured task.
@Suite("SmartParser", .tags(.parser))
struct SmartParserTests {

    // MARK: - Fixtures

    private static let groceries = SmartParser.ListRef(id: "list-groc", name: "Groceries")
    private static let work = SmartParser.ListRef(id: "list-work", name: "Work")
    private static let health = SmartParser.ListRef(id: "list-health", name: "Health")
    private static let side = SmartParser.ListRef(id: "list-side", name: "Side Project")

    private static let allLists: [SmartParser.ListRef] = [groceries, work, health, side]

    /// Fixed "now" — 10:00 AM on a Wednesday (2026-04-15) so relative-day
    /// tests have a stable anchor. Wednesday makes "next friday" vs
    /// "friday" non-trivial (2 days vs 9 days).
    private static func fixedNow() -> Date {
        var components = DateComponents()
        components.year = 2026
        components.month = 4
        components.day = 15 // Wednesday
        components.hour = 10
        components.minute = 0
        components.second = 0
        components.timeZone = TimeZone(identifier: "UTC")
        return Calendar(identifier: .gregorian).date(from: components)!
    }

    private static func context(page: Int = 1) -> SmartParser.ParseContext {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return SmartParser.ParseContext(
            currentPage: page,
            lists: allLists,
            now: fixedNow(),
            calendar: cal
        )
    }

    // MARK: - 1. Plain text

    @Test("Plain task without any tokens produces a task with no due date or list")
    func plainTask() {
        let result = SmartParser.parse("buy milk", context: Self.context())
        #expect(result.title == "buy milk")
        #expect(result.dueDate == nil)
        #expect(result.reminder == nil)
        #expect(result.listId == nil)
        #expect(result.kind == .task)
    }

    // MARK: - 2. Relative day

    @Test("'tomorrow' extracts next-day anchor with morning_of reminder")
    func tomorrowOnly() {
        let result = SmartParser.parse("buy milk tomorrow", context: Self.context())
        #expect(result.title == "buy milk")
        #expect(result.dueDate != nil)
        #expect(result.hasExplicitTime == false)
        #expect(result.reminder == .morningOf)

        let expected = Self.context().calendar.date(byAdding: .day, value: 1, to: Self.context().calendar.startOfDay(for: Self.fixedNow()))
        #expect(result.dueDate == expected)
    }

    // MARK: - 3. Relative day + explicit time

    @Test("'tomorrow at 5pm' parses day + time and sets oneHourBefore reminder")
    func tomorrowAtFivePm() {
        let result = SmartParser.parse("buy milk tomorrow at 5pm", context: Self.context())
        #expect(result.title == "buy milk")
        #expect(result.hasExplicitTime)
        #expect(result.reminder == .oneHourBefore)

        let cal = Self.context().calendar
        let day = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: Self.fixedNow()))!
        let expected = cal.date(bySettingHour: 17, minute: 0, second: 0, of: day)
        #expect(result.dueDate == expected)
    }

    // MARK: - 4. List tag — exact match

    @Test("'#groceries' exact match assigns to the groceries list and strips token")
    func listTagExact() {
        let result = SmartParser.parse("buy milk #groceries", context: Self.context())
        #expect(result.title == "buy milk")
        #expect(result.listId == Self.groceries.id)
    }

    // MARK: - 5. List tag — partial match

    @Test("'#groc' prefix match resolves to groceries")
    func listTagPartial() {
        let result = SmartParser.parse("buy milk #groc", context: Self.context())
        #expect(result.title == "buy milk")
        #expect(result.listId == Self.groceries.id)
    }

    // MARK: - 6. Unknown list tag is left in title

    @Test("An unknown #tag produces no list match and leaves the tag in the title")
    func unknownListTag() {
        let result = SmartParser.parse("buy #nonexistent", context: Self.context())
        #expect(result.listId == nil)
        // Title still shows the original tag so the user knows it didn't match.
        #expect(result.title.contains("#nonexistent"))
    }

    // MARK: - 7. Weekday forcing next week

    @Test("'next friday' on a Wednesday is 9 days away, not 2")
    func nextFriday() {
        let result = SmartParser.parse("call mom next friday", context: Self.context())
        #expect(result.title == "call mom")
        #expect(result.dueDate != nil)

        let cal = Self.context().calendar
        // Wednesday → this Friday is 2 days away (April 17), next Friday is April 24.
        let expectedDay = cal.date(byAdding: .day, value: 9, to: cal.startOfDay(for: Self.fixedNow()))
        #expect(result.dueDate == expectedDay)
    }

    // MARK: - 8. Bare weekday (this week)

    @Test("'friday' without 'next' resolves to this coming Friday")
    func bareFriday() {
        let result = SmartParser.parse("call mom friday", context: Self.context())
        #expect(result.title == "call mom")
        let cal = Self.context().calendar
        let expectedDay = cal.date(byAdding: .day, value: 2, to: cal.startOfDay(for: Self.fixedNow()))
        #expect(result.dueDate == expectedDay)
    }

    // MARK: - 9. Questions — trailing ?

    @Test("Trailing question mark marks the input as a question")
    func trailingQuestion() {
        let result = SmartParser.parse("why is the sky blue?", context: Self.context())
        #expect(result.kind == .question)
        // Title drops the `?` for cleanliness.
        #expect(result.title.hasSuffix("blue"))
    }

    // MARK: - 10. Questions — WH prefix

    @Test("'what should I do today' is classified as a question even without ?")
    func whPrefixQuestion() {
        let result = SmartParser.parse("what should I do today", context: Self.context())
        #expect(result.kind == .question)
    }

    // MARK: - 11. Calendar page forces .event

    @Test("On the Calendar page, a plain-ish input becomes an event")
    func calendarPageEvent() {
        // Calendar is index 3 after the Lists tab was added at index 0.
        // If this breaks, check `MainContainer.currentPage` and the page
        // ordering in the TabView.
        let result = SmartParser.parse("meeting at 3pm", context: Self.context(page: 3))
        #expect(result.kind == .event)
        #expect(result.hasExplicitTime)
    }

    // MARK: - 12. Time-only in the future today

    @Test("'at 5pm' at 10am today lands at 5pm today")
    func timeOnlyFuture() {
        let result = SmartParser.parse("standup at 5pm", context: Self.context())
        #expect(result.dueDate != nil)
        let cal = Self.context().calendar
        let expected = cal.date(bySettingHour: 17, minute: 0, second: 0, of: cal.startOfDay(for: Self.fixedNow()))
        #expect(result.dueDate == expected)
    }

    // MARK: - 13. Time-only in the past rolls to tomorrow

    @Test("'at 8am' when it's already 10am shifts to tomorrow")
    func timeOnlyPastRollsOver() {
        let result = SmartParser.parse("call dentist at 8am", context: Self.context())
        let cal = Self.context().calendar
        let today8 = cal.date(bySettingHour: 8, minute: 0, second: 0, of: cal.startOfDay(for: Self.fixedNow()))!
        let expected = cal.date(byAdding: .day, value: 1, to: today8)
        #expect(result.dueDate == expected)
    }

    // MARK: - 14. "in 3 days"

    @Test("'in 3 days' resolves to start-of-day 3 days out (no time token)")
    func relativeDuration() {
        let result = SmartParser.parse("ping Alice in 3 days", context: Self.context())
        #expect(result.dueDate != nil)
        // No time token, so the parser anchors the relative duration at
        // start-of-day. That matches how "in 3 days" reads as a task due
        // date — the user isn't committing to 10:00 AM.
        let cal = Self.context().calendar
        let expectedDay = cal.date(byAdding: .day, value: 3, to: cal.startOfDay(for: Self.fixedNow()))
        #expect(result.dueDate == expectedDay)
    }

    // MARK: - 15. "at noon"

    @Test("'at noon' parses to 12:00 on the chosen day")
    func atNoon() {
        let result = SmartParser.parse("lunch with Sam at noon", context: Self.context())
        #expect(result.dueDate != nil)
        let cal = Self.context().calendar
        let expected = cal.date(bySettingHour: 12, minute: 0, second: 0, of: cal.startOfDay(for: Self.fixedNow()))
        #expect(result.dueDate == expected)
    }

    // MARK: - 16. HH:MM form

    @Test("'at 3:30' parses minutes too")
    func colonTime() {
        let result = SmartParser.parse("sync at 3:30pm", context: Self.context())
        #expect(result.dueDate != nil)
        let cal = Self.context().calendar
        let expected = cal.date(bySettingHour: 15, minute: 30, second: 0, of: cal.startOfDay(for: Self.fixedNow()))
        #expect(result.dueDate == expected)
    }

    // MARK: - 17. Title cleanup

    @Test("Date tokens are fully stripped from the title")
    func titleCleanup() {
        let result = SmartParser.parse("  buy milk tomorrow at 5pm   ", context: Self.context())
        #expect(result.title == "buy milk")
    }

    // MARK: - 18. List + date + time combo

    @Test("A complete input — list, day, time — parses all three")
    func everythingAtOnce() {
        let result = SmartParser.parse("file taxes #work tomorrow at 9am", context: Self.context())
        #expect(result.title == "file taxes")
        #expect(result.listId == Self.work.id)
        #expect(result.hasExplicitTime)
        let cal = Self.context().calendar
        let day = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: Self.fixedNow()))!
        let expected = cal.date(bySettingHour: 9, minute: 0, second: 0, of: day)
        #expect(result.dueDate == expected)
    }

    // MARK: - 19. Empty input stays empty

    @Test("Empty input yields an empty task — parser must not crash")
    func emptyInput() {
        let result = SmartParser.parse("   ", context: Self.context())
        #expect(result.title == "")
        #expect(result.dueDate == nil)
        #expect(result.kind == .task)
    }

    // MARK: - 20. Case insensitivity

    @Test("Upper- and mixed-case keywords still match")
    func caseInsensitive() {
        let result = SmartParser.parse("Buy Milk TOMORROW AT 5PM", context: Self.context())
        #expect(result.title == "Buy Milk")
        #expect(result.hasExplicitTime)
    }

    // MARK: - 21. Calendar page + question

    @Test("A question on the calendar page is still a question, not an event")
    func questionBeatsCalendar() {
        let result = SmartParser.parse("what's the weather?", context: Self.context(page: 2))
        #expect(result.kind == .question)
    }

    // MARK: - 22. List tag with trailing punctuation

    @Test("'#groceries,' still resolves — the regex tolerates word boundaries")
    func listTagWithPunctuation() {
        let result = SmartParser.parse("buy milk #groceries, please", context: Self.context())
        #expect(result.listId == Self.groceries.id)
        #expect(result.title.contains("buy milk"))
        #expect(result.title.contains("please"))
    }
}
