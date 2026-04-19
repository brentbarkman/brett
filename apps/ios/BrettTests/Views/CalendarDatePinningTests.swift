import Foundation
import Testing
@testable import Brett

/// Regression coverage for stale calendar anchors after the app sits in the
/// background overnight (or the device sleeps and wakes into a new day).
/// `CalendarPage.selectedDate` used to seed once and never advance — users
/// would reopen the app and find the calendar still on yesterday. The
/// `snapForwardIfStale` helper drives the scenePhase-triggered rollover.
@Suite("CalendarDatePinning", .tags(.views))
struct CalendarDatePinningTests {

    @Test func snapsForwardWhenPinnedAndDayRolledOver() {
        let cal = Calendar(identifier: .gregorian)
        let yesterday = makeDate(year: 2026, month: 4, day: 18, hour: 22)
        let today = makeDate(year: 2026, month: 4, day: 19, hour: 9)

        let result = CalendarPage.snapForwardIfStale(
            selected: yesterday,
            pinned: true,
            now: today,
            calendar: cal,
        )

        #expect(cal.isDate(result, inSameDayAs: today))
    }

    @Test func leavesSelectionAloneWhenNotPinned() {
        let cal = Calendar(identifier: .gregorian)
        let april10 = makeDate(year: 2026, month: 4, day: 10, hour: 9)
        let today = makeDate(year: 2026, month: 4, day: 19, hour: 9)

        let result = CalendarPage.snapForwardIfStale(
            selected: april10,
            pinned: false,
            now: today,
            calendar: cal,
        )

        #expect(result == april10)
    }

    @Test func leavesSelectionAloneWhenPinnedAndSameDay() {
        let cal = Calendar(identifier: .gregorian)
        let morning = makeDate(year: 2026, month: 4, day: 19, hour: 8)
        let evening = makeDate(year: 2026, month: 4, day: 19, hour: 22)

        let result = CalendarPage.snapForwardIfStale(
            selected: morning,
            pinned: true,
            now: evening,
            calendar: cal,
        )

        #expect(result == morning)
    }

    private func makeDate(year: Int, month: Int, day: Int, hour: Int) -> Date {
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = day
        comps.hour = hour
        return Calendar(identifier: .gregorian).date(from: comps)!
    }
}
