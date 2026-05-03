import Foundation
import Testing
@testable import Brett

/// Coverage for `AmplitudeThrottle` — the peak-hold + interval-throttle
/// helper that lives between the audio tap callback and the main-actor
/// amplitude UI. Pre-throttle the audio tap fired one MainActor-hop
/// `Task` per buffer (~43Hz); the throttle coalesces to ~20Hz peaks.
///
/// All cases drive `now` directly so there's no real wall-clock dependency
/// — the throttle's only state is the lock-protected peak + lastPushAt.
@Suite("AmplitudeThrottle", .tags(.views))
struct AmplitudeThrottleTests {

    @Test func firstSampleAlwaysReturnsImmediately() {
        let throttle = AmplitudeThrottle(pushInterval: 0.05)
        // `lastPushAt` is `.distantPast`, so any `now` is past the
        // interval. First observation should yield the sample.
        let result = throttle.observe(0.42, now: epoch)
        #expect(result == 0.42)
    }

    @Test func samplesInsideWindowAreSuppressed() {
        let throttle = AmplitudeThrottle(pushInterval: 0.05)
        _ = throttle.observe(0.3, now: epoch)
        // 30ms later — still inside the 50ms window, should suppress.
        let result = throttle.observe(0.4, now: epoch.addingTimeInterval(0.03))
        #expect(result == nil)
    }

    @Test func peakHoldReportsLoudestSampleSinceLastPush() {
        let throttle = AmplitudeThrottle(pushInterval: 0.05)
        _ = throttle.observe(0.0, now: epoch) // first pushes immediately
        // Inside the window: feed 0.2, 0.6, 0.4 — peak is 0.6.
        _ = throttle.observe(0.2, now: epoch.addingTimeInterval(0.01))
        _ = throttle.observe(0.6, now: epoch.addingTimeInterval(0.02))
        _ = throttle.observe(0.4, now: epoch.addingTimeInterval(0.03))
        // After the window, the next observe returns the peak.
        let result = throttle.observe(0.1, now: epoch.addingTimeInterval(0.06))
        #expect(result == 0.6)
    }

    @Test func peakResetsAfterEachPush() {
        let throttle = AmplitudeThrottle(pushInterval: 0.05)
        _ = throttle.observe(0.5, now: epoch)            // push: 0.5
        _ = throttle.observe(0.9, now: epoch.addingTimeInterval(0.06))  // push: 0.9
        // Next push should NOT remember the prior 0.9 — only the
        // sample fed since the last push counts.
        let result = throttle.observe(0.2, now: epoch.addingTimeInterval(0.12))
        #expect(result == 0.2)
    }

    @Test func sampleExactlyAtIntervalBoundaryPushes() {
        // Boundary check — `>=` not `>`. A sample arriving exactly at
        // pushInterval should fire so the cadence stays even.
        let throttle = AmplitudeThrottle(pushInterval: 0.05)
        _ = throttle.observe(0.3, now: epoch)
        let result = throttle.observe(0.4, now: epoch.addingTimeInterval(0.05))
        #expect(result == 0.4)
    }

    @Test func resetClearsPeakAndPushHistory() {
        let throttle = AmplitudeThrottle(pushInterval: 0.05)
        _ = throttle.observe(0.5, now: epoch) // sets lastPushAt
        // Inside the window — would normally suppress.
        let beforeReset = throttle.observe(0.7, now: epoch.addingTimeInterval(0.01))
        #expect(beforeReset == nil)

        throttle.reset()

        // After reset, the next sample should fire immediately again
        // because lastPushAt is back to .distantPast.
        let afterReset = throttle.observe(0.1, now: epoch.addingTimeInterval(0.02))
        #expect(afterReset == 0.1)
    }

    @Test func resetDropsAccumulatedPeak() {
        let throttle = AmplitudeThrottle(pushInterval: 0.05)
        _ = throttle.observe(0.0, now: epoch) // pushes 0.0
        _ = throttle.observe(0.9, now: epoch.addingTimeInterval(0.01)) // accumulates peak 0.9
        throttle.reset()
        // Peak from before the reset must be gone — a tiny sample
        // should now report itself, not the prior loud peak.
        let result = throttle.observe(0.1, now: epoch.addingTimeInterval(0.06))
        #expect(result == 0.1)
    }

    private var epoch: Date { Date(timeIntervalSinceReferenceDate: 0) }
}
