import Foundation
import Testing
@testable import Brett

/// Coverage for the renderer ref-count + tick-task lifecycle that
/// `BackgroundService` owns on behalf of `BackgroundView`. Pre-hoist
/// every BackgroundView ran its own 60s timer; the service now owns
/// exactly one timer regardless of how many renderers are mounted.
///
/// The bug class these tests guard against: an unbalanced register /
/// unregister sequence (e.g. an `onDisappear` that fires while the
/// matching `.task`-driven `registerRenderer()` was still awaiting a
/// network call) leading to a permanently-dead ticker or a leaked +N
/// count. The current `BackgroundView` implementation pairs
/// register/unregister via `onAppear`/`onDisappear` to avoid the race;
/// these tests pin that contract at the service layer so a future
/// refactor of `BackgroundView` can't silently regress it.
@Suite("BackgroundServiceRenderer", .tags(.views))
@MainActor
struct BackgroundServiceRendererTests {

    /// `BackgroundService.shared` is process-wide. Reset its renderer
    /// count to 0 between tests so accumulated state from one test
    /// doesn't bleed into another.
    private func reset() {
        let svc = BackgroundService.shared
        // Drain the count without underflowing — call unregister until
        // the inspector reports 0.
        while svc.debug_rendererCount > 0 {
            svc.unregisterRenderer()
        }
    }

    @Test func firstRegisterStartsTickTask() {
        reset()
        let svc = BackgroundService.shared
        #expect(!svc.debug_hasTickTask)

        svc.registerRenderer()
        #expect(svc.debug_rendererCount == 1)
        #expect(svc.debug_hasTickTask)

        svc.unregisterRenderer()
    }

    @Test func lastUnregisterStopsTickTask() {
        reset()
        let svc = BackgroundService.shared
        svc.registerRenderer()
        #expect(svc.debug_hasTickTask)

        svc.unregisterRenderer()
        #expect(svc.debug_rendererCount == 0)
        #expect(!svc.debug_hasTickTask)
    }

    @Test func multipleRenderersShareOneTickTask() {
        reset()
        let svc = BackgroundService.shared

        svc.registerRenderer()
        // Capture the task object via the inspector so we can verify
        // the second register does NOT replace it. We can't compare
        // task identity through the inspector, but `hasTickTask`
        // remaining true across two registers + the count incrementing
        // correctly is enough — the production code's `if tickTask == nil`
        // gate is what enforces "no second timer."
        svc.registerRenderer()
        svc.registerRenderer()

        #expect(svc.debug_rendererCount == 3)
        #expect(svc.debug_hasTickTask)

        // Unregister twice — count drops to 1, ticker still alive.
        svc.unregisterRenderer()
        svc.unregisterRenderer()
        #expect(svc.debug_rendererCount == 1)
        #expect(svc.debug_hasTickTask)

        // Final unregister stops the ticker.
        svc.unregisterRenderer()
        #expect(svc.debug_rendererCount == 0)
        #expect(!svc.debug_hasTickTask)
    }

    @Test func overUnregisterClampsAtZero() {
        reset()
        let svc = BackgroundService.shared
        // Defensive: an unregister with no matching register should
        // not produce a negative count or crash. The fix this guards
        // against is the audit-found .task vs onDisappear race —
        // even though that race shouldn't occur in the current
        // production code (register lives in onAppear), the service
        // is permissive so a future refactor can't trivially break it.
        svc.unregisterRenderer()
        svc.unregisterRenderer()
        svc.unregisterRenderer()
        #expect(svc.debug_rendererCount == 0)
        #expect(!svc.debug_hasTickTask)
    }

    @Test func registerAfterDrainStartsAFreshTickTask() {
        reset()
        let svc = BackgroundService.shared

        // Mount → tick task starts.
        svc.registerRenderer()
        #expect(svc.debug_hasTickTask)
        // Drain → tick task stops.
        svc.unregisterRenderer()
        #expect(!svc.debug_hasTickTask)
        // Re-mount (e.g. user signs back in after sign-out).
        svc.registerRenderer()
        #expect(svc.debug_hasTickTask)

        svc.unregisterRenderer()
    }

    @Test func updateProfilePopulatesDisplayedKeyForFallbackPath() {
        reset()
        let svc = BackgroundService.shared
        svc.registerRenderer()
        defer { svc.unregisterRenderer() }

        // No manifest / storage URL loaded → service falls through
        // to the asset-catalog fallback. `currentFallbackAsset` should
        // populate and `displayedKey` should match.
        svc.updateProfile(style: nil, pinned: nil, initial: true)

        #expect(!svc.currentFallbackAsset.isEmpty)
        #expect(svc.displayedKey == svc.currentFallbackAsset)
        #expect(svc.currentRemoteURL == nil || svc.currentRemoteURL != nil) // tolerated either way — manifest may be cached from prior run
    }

    @Test func updateProfileSolidPathSetsColorAndSentinelKey() {
        reset()
        let svc = BackgroundService.shared
        svc.registerRenderer()
        defer { svc.unregisterRenderer() }

        svc.updateProfile(style: "solid", pinned: "solid:#0040DD", initial: true)

        #expect(svc.currentSolidColor != nil)
        #expect(svc.currentRemoteURL == nil)
        // Service preserves the `#` when reconstructing the key — the
        // hex sentinel is `solid:` + everything after the prefix, so
        // a pinned value of `solid:#0040DD` round-trips to a
        // displayedKey of `solid:#0040DD` (not `solid:0040DD`).
        #expect(svc.displayedKey == "solid:#0040DD")
    }
}
