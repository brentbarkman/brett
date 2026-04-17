import Foundation
import Testing
@testable import Brett

/// Week-strip rendering is deterministic math — the tests exercise the
/// static layout helpers rather than SwiftUI.
@Suite("CalendarWeekStrip", .tags(.views))
struct CalendarWeekStripTests {

    @Test func anchorIdIsStableForSameDay() {
        let cal = Calendar(identifier: .gregorian)
        let date = makeDate(year: 2026, month: 4, day: 14)
        let laterSameDay = cal.date(bySettingHour: 15, minute: 30, second: 0, of: date)!
        let a = WeekStrip.anchorId(for: date, calendar: cal)
        let b = WeekStrip.anchorId(for: laterSameDay, calendar: cal)
        #expect(a == b)
        #expect(a == "2026-4-14")
    }

    @Test func anchorIdsDifferByDay() {
        let cal = Calendar(identifier: .gregorian)
        let day1 = makeDate(year: 2026, month: 4, day: 14)
        let day2 = makeDate(year: 2026, month: 4, day: 15)
        #expect(WeekStrip.anchorId(for: day1, calendar: cal) != WeekStrip.anchorId(for: day2, calendar: cal))
    }

    @Test func weekdayLabelsCycleSunThroughSat() {
        let cal = Calendar(identifier: .gregorian)
        // 2026-04-12 is a Sunday in the Gregorian calendar.
        let sunday = makeDate(year: 2026, month: 4, day: 12)
        let labels = (0..<7).map { offset -> String in
            let d = cal.date(byAdding: .day, value: offset, to: sunday)!
            return WeekStrip.shortWeekdayLabel(for: d, calendar: cal)
        }
        #expect(labels.count == 7)
        #expect(labels.allSatisfy { !$0.isEmpty })
        // Sunday and Saturday share the same single-letter symbol on en-US.
        #expect(labels.first == labels.last)
    }

    @Test func paletteFallsBackToGoldOnUnknownColorId() {
        let fallback = EventColorPalette.color(forGoogleColorId: nil)
        let explicit = EventColorPalette.color(forGoogleColorId: "999")
        #expect(String(describing: fallback) == String(describing: explicit))
    }

    @Test func paletteReturnsDistinctColorsForKnownIds() {
        let a = String(describing: EventColorPalette.color(forGoogleColorId: "7"))
        let b = String(describing: EventColorPalette.color(forGoogleColorId: "11"))
        #expect(a != b)
    }

    private func makeDate(year: Int, month: Int, day: Int) -> Date {
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = day
        comps.hour = 9
        return Calendar(identifier: .gregorian).date(from: comps)!
    }
}
