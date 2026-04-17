import Foundation

/// A controllable "now" for date-dependent tests. Pass a `TestClock` into
/// production code wherever it would otherwise call `Date()`, and advance it
/// manually from the test:
///
/// ```swift
/// let clock = TestClock(now: Date(timeIntervalSince1970: 1_700_000_000))
/// let result = parser.parse("buy milk tomorrow at 5pm", now: clock.now)
/// clock.advance(by: 3600)
/// ```
///
/// AGENT COORDINATION NOTE:
/// Production code currently calls `Date()` directly. When sync engine / smart
/// parser / scheduler code lands, it should take a `() -> Date` closure or a
/// clock protocol so this test clock can be injected. Until then, use
/// `clock.now` manually where possible.
final class TestClock: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.brett.tests.TestClock")
    private var _now: Date

    init(now: Date = Date()) {
        self._now = now
    }

    /// The current (fake) time. Capture a fresh value each read; the test may
    /// have advanced the clock between calls.
    var now: Date {
        queue.sync { _now }
    }

    /// Push the clock forward by a number of seconds. Negative values rewind.
    func advance(by seconds: TimeInterval) {
        queue.sync { _now = _now.addingTimeInterval(seconds) }
    }

    /// Jump the clock to a specific moment.
    func set(_ date: Date) {
        queue.sync { _now = date }
    }

    /// Closure form for injection into code that accepts `() -> Date`.
    func provider() -> @Sendable () -> Date {
        { [weak self] in self?.now ?? Date() }
    }
}
