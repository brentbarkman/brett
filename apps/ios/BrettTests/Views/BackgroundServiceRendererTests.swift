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
    /// doesn't bleed into another. Also clears the cached remote URL
    /// so fallback-path tests start from a deterministic "no cache"
    /// baseline regardless of UserDefaults state on the simulator.
    private func reset() {
        let svc = BackgroundService.shared
        // Drain the count without underflowing — call unregister until
        // the inspector reports 0.
        while svc.debug_rendererCount > 0 {
            svc.unregisterRenderer()
        }
        svc.debug_resetRemoteCache()
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

    @Test func updateProfileLeavesEmptyDisplayedKeyForWashFallback() {
        reset()
        let svc = BackgroundService.shared
        svc.registerRenderer()
        defer { svc.unregisterRenderer() }

        // No manifest / storageBaseUrl loaded + no profile → wash-only
        // fallback. `displayedKey` stays empty so `BackgroundView`
        // renders only the wash bed; no image layer is inserted, no
        // transition fires. The previous bundled-asset fallback would
        // have populated `currentFallbackAsset` here and triggered a
        // visible crossfade once the real photo resolved — this test
        // pins the new "wash, then photo fades in" contract.
        svc.updateProfile(style: nil, pinned: nil, initial: true)

        #expect(svc.displayedKey.isEmpty)
        #expect(svc.currentRemoteURL == nil)
        #expect(svc.currentSolidColor == nil)
    }

    @Test func freshSingletonStartsWithEmptyDisplayedKey() {
        reset()
        let svc = BackgroundService.shared

        // Cold-launch contract: nothing painted until something is
        // resolved. The previous design seeded `displayedKey` from
        // UserDefaults at init so a cached URL painted before
        // `/config` returned — that produced the cross-user leak +
        // the visible swap. Now the only way to get a non-empty key
        // is to actually resolve one this session.
        #expect(svc.displayedKey.isEmpty)
        #expect(svc.currentRemoteURL == nil)
        #expect(svc.currentSolidColor == nil)
    }

    @Test func clearForSignOutResetsRenderState() {
        reset()
        let svc = BackgroundService.shared
        svc.registerRenderer()
        defer { svc.unregisterRenderer() }

        // Drive the service into a "resolved solid" state — easier to
        // assert than a remote URL because solid doesn't require the
        // manifest / storageBaseUrl. Same state surface gets cleared
        // either way; this just keeps the test hermetic.
        svc.updateProfile(style: "solid", pinned: "solid:#0040DD", initial: true)
        #expect(svc.currentSolidColor != nil)
        #expect(svc.displayedKey == "solid:#0040DD")

        // Sign-out fan-out lands here. The next render must start from
        // the wash bed alone — no leftover solid, URL, or key from the
        // signed-out user.
        svc.clearForSignOut()

        #expect(svc.currentSolidColor == nil)
        #expect(svc.currentRemoteURL == nil)
        #expect(svc.displayedKey.isEmpty)
    }

    @Test func clearForSignOutWipesBootstrapToDefendCrossUserLeak() {
        reset()
        let svc = BackgroundService.shared

        // The defense this test guards: between `clearForSignOut`
        // running and `PersistenceController.wipeAllData()` finishing,
        // SignInView's BackgroundView may mount and push the
        // (still-present) prior-user UserProfile row into
        // `updateProfile(...)` via @Query + .onAppear. If the
        // service's manifest + storageBaseUrl survive the clear,
        // `currentImageURL(...)` happily rebuilds the prior user's
        // pinned URL and `applyRemote(...)` paints it on the sign-in
        // screen. Wiping the bootstrap forces the wash fallback for
        // that intervening call — the worst case becomes "wash for
        // ~100ms on next sign-in while /config re-fetches" rather
        // than "prior user's photo flashes on the sign-in screen."
        svc.updateProfile(style: "solid", pinned: "solid:#0040DD", initial: true)
        #expect(svc.currentSolidColor != nil)

        svc.clearForSignOut()

        #expect(svc.manifest == nil)
        #expect(svc.storageBaseUrl == nil)
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
