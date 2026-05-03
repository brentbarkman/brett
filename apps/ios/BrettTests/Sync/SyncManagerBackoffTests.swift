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

    // MARK: - SSE-aware poll cadence
    //
    // `pollDelay(forFailures:sseHealthy:...)` folds the SSE health signal
    // into the cadence decision: when SSE is healthy AND no failures, the
    // poll relaxes from `pollInterval` → `relaxedPollInterval`. Failures
    // ALWAYS bypass the relaxation (a sync failure isn't something SSE
    // can fix, so we want fast retries regardless of realtime health).

    private let relaxed: TimeInterval = 120

    @Test func sseHealthyAndNoFailuresUsesRelaxedInterval() {
        let d = SyncManager.pollDelay(
            forFailures: 0,
            sseHealthy: true,
            pollInterval: poll,
            relaxedPollInterval: relaxed,
            maxBackoff: cap,
            jitter: 1.0
        )
        // 120s baseline with no jitter → 120s exactly.
        #expect(d == 120)
    }

    @Test func sseUnhealthyFallsBackToFastInterval() {
        let d = SyncManager.pollDelay(
            forFailures: 0,
            sseHealthy: false,
            pollInterval: poll,
            relaxedPollInterval: relaxed,
            maxBackoff: cap,
            jitter: 1.0
        )
        // SSE down → fast 30s baseline.
        #expect(d == 30)
    }

    @Test func failuresAlwaysOverrideRelaxedMode() {
        // SSE healthy but the last sync failed — we still want fast
        // retry because SSE can't tell us the cursor is broken.
        let d = SyncManager.pollDelay(
            forFailures: 1,
            sseHealthy: true,
            pollInterval: poll,
            relaxedPollInterval: relaxed,
            maxBackoff: cap,
            jitter: 1.0
        )
        // failure #1 → 30 * 2^1 = 60s, NOT 120s relaxed.
        #expect(d == 60)
    }

    @Test func failureBackoffMatchesEvenWhenSseHealthy() {
        // Spot-check failure #2 — should be 120s (30 * 2^2), same as
        // when SSE is unhealthy. Confirms the failure path doesn't
        // accidentally double-count by also relaxing.
        let unhealthy = SyncManager.pollDelay(
            forFailures: 2, sseHealthy: false,
            pollInterval: poll, relaxedPollInterval: relaxed,
            maxBackoff: cap, jitter: 1.0
        )
        let healthy = SyncManager.pollDelay(
            forFailures: 2, sseHealthy: true,
            pollInterval: poll, relaxedPollInterval: relaxed,
            maxBackoff: cap, jitter: 1.0
        )
        #expect(unhealthy == healthy)
        #expect(healthy == 120)
    }

    @Test func relaxedIntervalGetsJitter() {
        let low = SyncManager.pollDelay(
            forFailures: 0, sseHealthy: true,
            pollInterval: poll, relaxedPollInterval: relaxed,
            maxBackoff: cap, jitter: 0.8
        )
        let high = SyncManager.pollDelay(
            forFailures: 0, sseHealthy: true,
            pollInterval: poll, relaxedPollInterval: relaxed,
            maxBackoff: cap, jitter: 1.2
        )
        // 120s ±20% → 96s...144s.
        #expect(low == 96)
        #expect(high == 144)
    }
}
