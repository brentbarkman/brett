import Testing
import Foundation
@testable import Brett

/// Unit tests for `SyncManager.backoffDelay(...)`. Jitter is injected so
/// each tier's base value can be asserted exactly.
///
/// Documented growth (no jitter, 30s pollInterval, 300s cap):
///     0 failures → 30s
///     1 failure  → 60s
///     2 failures → 120s
///     3 failures → 240s
///     4 failures → 300s (capped)
///     10 failures → 300s (still capped)
///
/// The load-bearing fix this guards against: before the refactor, failure #1
/// resolved to `30s * 2^0 = 30s` — identical to the healthy poll interval.
/// A single network blip produced zero observable backoff.
@Suite("SyncManager backoff", .tags(.sync), .serialized)
struct SyncManagerBackoffTests {
    private let poll: TimeInterval = 30
    private let cap: TimeInterval = 300

    @Test func zeroFailuresUsesPollInterval() {
        let d = SyncManager.backoffDelay(
            forFailures: 0, pollInterval: poll, maxBackoff: cap, jitter: 1.0
        )
        #expect(d == 30)
    }

    @Test func firstFailureDoublesFromPollInterval() {
        let d = SyncManager.backoffDelay(
            forFailures: 1, pollInterval: poll, maxBackoff: cap, jitter: 1.0
        )
        #expect(d == 60)
    }

    @Test func secondFailureDoublesAgain() {
        let d = SyncManager.backoffDelay(
            forFailures: 2, pollInterval: poll, maxBackoff: cap, jitter: 1.0
        )
        #expect(d == 120)
    }

    @Test func thirdFailureDoubles() {
        let d = SyncManager.backoffDelay(
            forFailures: 3, pollInterval: poll, maxBackoff: cap, jitter: 1.0
        )
        #expect(d == 240)
    }

    @Test func fourthFailureHitsCap() {
        // 30 * 2^4 = 480, capped to 300.
        let d = SyncManager.backoffDelay(
            forFailures: 4, pollInterval: poll, maxBackoff: cap, jitter: 1.0
        )
        #expect(d == 300)
    }

    @Test func tenthFailureStaysAtCap() {
        let d = SyncManager.backoffDelay(
            forFailures: 10, pollInterval: poll, maxBackoff: cap, jitter: 1.0
        )
        #expect(d == 300)
    }

    @Test func jitterIsApplied() {
        let low = SyncManager.backoffDelay(
            forFailures: 1, pollInterval: poll, maxBackoff: cap, jitter: 0.8
        )
        let high = SyncManager.backoffDelay(
            forFailures: 1, pollInterval: poll, maxBackoff: cap, jitter: 1.2
        )
        // Base 60s with ±20% jitter → 48s...72s.
        #expect(low == 48)
        #expect(high == 72)
    }
}
