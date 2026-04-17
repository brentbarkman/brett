import Foundation
import Testing
@testable import Brett

/// Tests the once-per-day playback logic used by ``MorningRitualModifier``.
///
/// The view layer is a thin shell over ``MorningRitual.shouldPlay`` /
/// ``markPlayed``, so these tests cover the pure date math against an
/// isolated `UserDefaults` suite.
@Suite("Morning ritual", .tags(.views))
struct MorningRitualTests {

    // MARK: - Helpers

    /// Returns a fresh, isolated `UserDefaults` instance so tests don't
    /// read/write to the app's real preferences.
    private func makeDefaults(file: String = #filePath, line: Int = #line) -> UserDefaults {
        let suite = "brett.tests.morning-ritual.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    private var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        // Anchor to a fixed timezone so "same day" comparisons are
        // deterministic across CI environments.
        cal.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return cal
    }

    private func date(
        year: Int, month: Int, day: Int,
        hour: Int = 9, minute: Int = 0
    ) -> Date {
        calendar.date(from: DateComponents(
            timeZone: calendar.timeZone,
            year: year, month: month, day: day,
            hour: hour, minute: minute
        ))!
    }

    // MARK: - shouldPlay(lastPlayed:now:calendar:)

    @Test("First run (lastPlayed == nil) should play")
    func firstRunPlays() {
        let now = date(year: 2026, month: 4, day: 14)
        #expect(MorningRitual.shouldPlay(lastPlayed: nil, now: now, calendar: calendar))
    }

    @Test("Same day (played earlier today) should not replay")
    func sameDayDoesNotReplay() {
        let earlier = date(year: 2026, month: 4, day: 14, hour: 6)
        let later = date(year: 2026, month: 4, day: 14, hour: 22)
        #expect(
            !MorningRitual.shouldPlay(lastPlayed: earlier, now: later, calendar: calendar),
            "Ritual must only play once per local day"
        )
    }

    @Test("Next day (played yesterday) should replay")
    func nextDayReplays() {
        let yesterday = date(year: 2026, month: 4, day: 13, hour: 18)
        let today = date(year: 2026, month: 4, day: 14, hour: 7)
        #expect(MorningRitual.shouldPlay(lastPlayed: yesterday, now: today, calendar: calendar))
    }

    @Test("Crossing midnight replays even when only minutes apart")
    func crossingMidnightReplays() {
        let beforeMidnight = date(year: 2026, month: 4, day: 14, hour: 23, minute: 59)
        let afterMidnight = date(year: 2026, month: 4, day: 15, hour: 0, minute: 1)
        #expect(MorningRitual.shouldPlay(
            lastPlayed: beforeMidnight, now: afterMidnight, calendar: calendar
        ))
    }

    // MARK: - UserDefaults integration

    @Test("markPlayed + shouldPlay round-trip via UserDefaults")
    func persistenceRoundTrip() {
        let defaults = makeDefaults()
        let now = date(year: 2026, month: 4, day: 14)

        // First check: nothing persisted yet.
        #expect(MorningRitual.shouldPlay(now: now, defaults: defaults, calendar: calendar))

        // Persist and re-check within the same day.
        MorningRitual.markPlayed(now: now, defaults: defaults)
        #expect(
            !MorningRitual.shouldPlay(now: now, defaults: defaults, calendar: calendar),
            "After markPlayed, the ritual should not replay on the same day"
        )

        // Tomorrow it should replay.
        let tomorrow = date(year: 2026, month: 4, day: 15)
        #expect(MorningRitual.shouldPlay(now: tomorrow, defaults: defaults, calendar: calendar))
    }

    @Test("Empty UserDefaults treats stored 0.0 as never-played")
    func emptyDefaultsIsNeverPlayed() {
        let defaults = makeDefaults()
        // Sanity: a fresh suite has no value for our key, so `double(forKey:)`
        // returns 0.0 — we must not treat that as a legitimate Jan 1 1970
        // timestamp.
        let now = date(year: 2026, month: 4, day: 14)
        #expect(MorningRitual.shouldPlay(now: now, defaults: defaults, calendar: calendar))
    }
}
