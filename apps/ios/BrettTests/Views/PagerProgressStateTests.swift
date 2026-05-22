import Foundation
import Testing
@testable import Brett

/// Coverage for `PagerProgressState` (the @Observable singleton that
/// replaces the old `@Binding<CGFloat>` pair on `PagedSwipeView`) and
/// `AdaptiveChromeOpacity.compute` (the pure opacity curve that both
/// `GlobalPhotoLayer` and `BriefingCanopyOverlay` route through).
///
/// The singleton itself is tiny — its job is to threshold no-op
/// writes (so subscribers don't re-render on numerically negligible
/// deltas) and to provide a reset that subscribers see atomically at
/// gesture end. The opacity helper is the calm-hero curve, exercised
/// here without a UIScrollView harness so the behaviour the user
/// notices (smooth crossfade, no pop-in, no flash during cancelled
/// swipes) is regression-guarded as a pure-function contract.
@Suite("PagerProgressState + adaptive chrome")
@MainActor
struct PagerProgressStateTests {

    // MARK: - Singleton thresholding

    /// `publish` is the hot path — fires 60-120 times per second
    /// during a swipe. A no-op write (value identical to the current
    /// one) still notifies SwiftUI's Observation framework, so the
    /// thresholding guard is what keeps the leaf views from
    /// re-rendering on truly negligible per-frame deltas. Guard the
    /// threshold so it can't be tightened without anyone noticing.
    @Test func publishSkipsWritesUnderThreshold() {
        let state = PagerProgressState.shared
        state.reset()

        // Establish a baseline.
        state.publish(magnitude: 0.5, signed: 0.5)
        #expect(state.dragProgress == 0.5)
        #expect(state.signedDragProgress == 0.5)

        // Sub-threshold delta (< 0.001) should NOT update. The
        // dragProgress field stays exactly at the previous value.
        state.publish(magnitude: 0.5005, signed: 0.5005)
        #expect(state.dragProgress == 0.5)
        #expect(state.signedDragProgress == 0.5)
    }

    /// Anything above the 0.001 threshold IS published. This is the
    /// happy path — most per-frame deltas during a real swipe are
    /// well above this floor.
    @Test func publishApplyWritesAboveThreshold() {
        let state = PagerProgressState.shared
        state.reset()

        state.publish(magnitude: 0.3, signed: 0.3)
        #expect(state.dragProgress == 0.3)
        #expect(state.signedDragProgress == 0.3)

        // 0.0011 > 0.001 — write applies.
        state.publish(magnitude: 0.3011, signed: 0.3011)
        #expect(state.dragProgress == 0.3011)
        #expect(state.signedDragProgress == 0.3011)
    }

    /// `reset` returns both fields to zero. Called from
    /// `didFinishAnimating`, `scrollViewDidEndDecelerating`, and
    /// the in-scroll page-commit bump — all the places where the
    /// post-gesture crossfade needs to settle on a clean baseline.
    @Test func resetClearsBothFields() {
        let state = PagerProgressState.shared
        state.publish(magnitude: 0.8, signed: -0.8)
        #expect(state.dragProgress == 0.8)
        #expect(state.signedDragProgress == -0.8)

        state.reset()
        #expect(state.dragProgress == 0)
        #expect(state.signedDragProgress == 0)
    }

    /// `reset` from zero is a no-op (no spurious notification). The
    /// guard inside `reset` ensures multiple consumers don't see a
    /// 0 → 0 "change" that would invalidate them anyway.
    @Test func resetFromZeroIsIdempotent() {
        let state = PagerProgressState.shared
        state.reset()
        #expect(state.dragProgress == 0)
        #expect(state.signedDragProgress == 0)

        // Second reset — must be safe to call repeatedly. We can't
        // directly observe "notification didn't fire" in a unit
        // test, but exercising the path proves the guard branch is
        // reached.
        state.reset()
        #expect(state.dragProgress == 0)
        #expect(state.signedDragProgress == 0)
    }

    // MARK: - Adaptive-chrome opacity curve

    /// On Today (index 2) with no scroll and no drag, the photo +
    /// canopy are at full opacity — the calm-hero direction is "the
    /// photo IS the wallpaper of Today."
    @Test func opacityAtTodayRestStateIsOne() {
        let opacity = AdaptiveChromeOpacity.compute(
            currentPage: 2,
            signedDragProgress: 0,
            heroScrollOffset: 0,
            heroFadeDistance: 140
        )
        #expect(opacity == 1.0)
    }

    /// On the inbox (index 1), settled (no drag), the photo is
    /// invisible. `distanceFromToday = 1`, `proximityToToday = 0`.
    /// This is the pre-refactor behaviour — pages that aren't Today
    /// don't get the photo treatment.
    @Test func opacityOnNonTodayPageAtRestIsZero() {
        for page in [0, 1, 3] {
            let opacity = AdaptiveChromeOpacity.compute(
                currentPage: page,
                signedDragProgress: 0,
                heroScrollOffset: 0,
                heroFadeDistance: 140
            )
            #expect(opacity == 0.0, "Page \(page) at rest should be 0")
        }
    }

    /// Mid-swipe from Inbox (1) toward Today (2): `signedDragProgress`
    /// is positive (moving to higher index). At drag = 0.5, the
    /// effective page is 1.5, distance from Today is 0.5, proximity
    /// is 0.5 — the photo crossfades IN smoothly. This is the behaviour
    /// the user explicitly asked us to preserve.
    @Test func opacityRampsInDuringSwipeTowardToday() {
        let drag: [(progress: CGFloat, expected: Double)] = [
            (0.0, 0.0),
            (0.25, 0.25),
            (0.5, 0.5),
            (0.75, 0.75),
            (1.0, 1.0),
        ]
        for (progress, expected) in drag {
            let opacity = AdaptiveChromeOpacity.compute(
                currentPage: 1,
                signedDragProgress: progress,
                heroScrollOffset: 0,
                heroFadeDistance: 140
            )
            #expect(abs(opacity - expected) < 0.001, "drag \(progress): got \(opacity)")
        }
    }

    /// Mid-swipe from Today (2) toward Inbox (1): drag is negative.
    /// Photo fades OUT in lockstep — same curve, opposite direction.
    /// Without this symmetry the swipe-away would look different
    /// from the swipe-toward.
    @Test func opacityRampsOutDuringSwipeAwayFromToday() {
        let drag: [(progress: CGFloat, expected: Double)] = [
            (0.0, 1.0),
            (-0.25, 0.75),
            (-0.5, 0.5),
            (-0.75, 0.25),
            (-1.0, 0.0),
        ]
        for (progress, expected) in drag {
            let opacity = AdaptiveChromeOpacity.compute(
                currentPage: 2,
                signedDragProgress: progress,
                heroScrollOffset: 0,
                heroFadeDistance: 140
            )
            #expect(abs(opacity - expected) < 0.001, "drag \(progress): got \(opacity)")
        }
    }

    /// Scrolling Today's hero downward fades the photo out — the
    /// chrome transitions to the "work" mode. Hero offset > the
    /// fade distance pegs the photo at 0.
    @Test func verticalScrollOnTodayFadesPhotoOut() {
        let cases: [(offset: CGFloat, expected: Double)] = [
            (0,   1.0),
            (35,  0.75),
            (70,  0.5),
            (105, 0.25),
            (140, 0.0),
            (200, 0.0),  // clamped — beyond fade distance stays at 0
        ]
        for (offset, expected) in cases {
            let opacity = AdaptiveChromeOpacity.compute(
                currentPage: 2,
                signedDragProgress: 0,
                heroScrollOffset: offset,
                heroFadeDistance: 140
            )
            #expect(abs(opacity - expected) < 0.001, "offset \(offset): got \(opacity)")
        }
    }

    /// On non-Today pages, vertical scroll on Today is IRRELEVANT —
    /// the photo opacity is 0 regardless of `heroScrollOffset`. Guards
    /// the `scrollFactor: Double = currentPage == todayIndex ? ... : 1.0`
    /// branch so a future "let's use scrollFactor everywhere" refactor
    /// can't sneak in and wash the photo to wash on every page.
    @Test func nonTodayPageIgnoresHeroScroll() {
        for page in [0, 1, 3] {
            for offset: CGFloat in [0, 70, 200] {
                let opacity = AdaptiveChromeOpacity.compute(
                    currentPage: page,
                    signedDragProgress: 0,
                    heroScrollOffset: offset,
                    heroFadeDistance: 140
                )
                #expect(opacity == 0.0, "Page \(page) offset \(offset)")
            }
        }
    }

    /// Effective page more than 1 unit away from Today produces 0
    /// opacity — `1 - distanceFromToday` clamps via `max(0, ...)`.
    /// Covers: settled-on-Lists (page 0), settled-on-Calendar
    /// (page 3), and pathological overshoot from rubber-band
    /// overscroll that lands an effective page past the end of
    /// the page range.
    @Test func opacityClampsAtZeroBeyondOneUnitFromToday() {
        // Settled on Lists (page 0). Distance = 2. Clamped to 0.
        let onLists = AdaptiveChromeOpacity.compute(
            currentPage: 0,
            signedDragProgress: 0,
            heroScrollOffset: 0,
            heroFadeDistance: 140
        )
        #expect(onLists == 0.0)

        // Pathological overshoot — should still produce a sane,
        // clamped value rather than a negative opacity.
        let overshoot = AdaptiveChromeOpacity.compute(
            currentPage: 0,
            signedDragProgress: -2,
            heroScrollOffset: 0,
            heroFadeDistance: 140
        )
        // effectivePage = -2, distance from Today (2) = 4,
        // 1 - 4 = -3, max(0, -3) = 0.
        #expect(overshoot == 0.0)
    }
}
