import Observation
import SwiftUI

/// Shared live pager-drag progress published by `PagedSwipeView` so the
/// calm-hero crossfades (global photo, briefing canopy, omnibar
/// background opacity, view-pills visibility) can read drag-state
/// without forcing the top-level `MainContainer` body to re-render on
/// every scroll-view callback.
///
/// ### Why a shared @Observable instead of @Binding into MainContainer
///
/// `PagedSwipeView`'s inner UIScrollView fires `scrollViewDidScroll`
/// every frame during a drag *and* during the post-release settle
/// (60-120 Hz on ProMotion). Earlier, the coordinator wrote these
/// values to two `@Binding<CGFloat>` properties bound to MainContainer
/// `@State`. Each write invalidated MainContainer's body — which
/// reads the values via `photoOpacity` / `pillsVisibility` /
/// `omnibarBackgroundOpacity` computed properties — so MainContainer
/// re-evaluated its entire ZStack on every scroll frame.
///
/// SwiftUI's Observation framework registers reads on
/// `@Observable` instances during a view's body evaluation and
/// invalidates *only* the views that performed those reads. By
/// moving drag progress onto a singleton @Observable and routing
/// the reads through small leaf views (GlobalPhotoLayer,
/// BriefingCanopyOverlay, the adaptive omnibar / pills wrappers in
/// `MainContainer.swift`), MainContainer's body no longer
/// subscribes to per-frame drag updates. Only the leaves re-render.
///
/// This is the same shape as `HeroScrollState` — both are
/// high-frequency publishers that the chrome reads from many places,
/// and both benefit from the subtree-isolated re-render behaviour the
/// Observation framework provides.
///
/// ### Lifecycle
///
/// Singleton, main-actor isolated. Mutations happen exclusively from
/// `PagedSwipeView.Coordinator` callbacks (which run on the main
/// actor by way of the UIScrollViewDelegate contract). Reads happen
/// from any SwiftUI view that needs adaptive chrome.
///
/// Both properties are reset to 0 at the end of a swipe gesture —
/// once UIPageViewController's `didFinishAnimating` or
/// `scrollViewDidEndDecelerating` fires. The reset is what causes the
/// post-commit crossfades to settle on their final values.
@MainActor
@Observable
final class PagerProgressState {
    static let shared = PagerProgressState()

    /// Magnitude 0…1 of how far the user has dragged from the
    /// current page toward an adjacent one. Always non-negative.
    /// Resets to 0 between swipes.
    private(set) var dragProgress: CGFloat = 0

    /// Signed -1…+1. Positive when the user drags toward a HIGHER
    /// index (next page); negative toward a LOWER index. Lets
    /// callers compute "where is the user effectively pointing" for
    /// crossfades that need direction (e.g. fading the global photo
    /// only while moving away from Today). Resets to 0 between
    /// swipes.
    private(set) var signedDragProgress: CGFloat = 0

    private init() {}

    /// Publish a new drag progress pair. Mirrors the prior
    /// `if abs(x - new) > 0.001 { x = new }` guards from
    /// PagedSwipeView so consumers don't re-render on numerically
    /// negligible deltas — the threshold is well below visual
    /// perceptibility, and skipping no-op writes keeps the
    /// Observation framework from invalidating subscribers
    /// unnecessarily.
    func publish(magnitude: CGFloat, signed: CGFloat) {
        if abs(dragProgress - magnitude) > 0.001 {
            dragProgress = magnitude
        }
        if abs(signedDragProgress - signed) > 0.001 {
            signedDragProgress = signed
        }
    }

    /// Reset both values to 0. Called when a swipe ends (commit or
    /// cancel) so the crossfades settle on their post-gesture
    /// values. Idempotent.
    func reset() {
        if dragProgress != 0 { dragProgress = 0 }
        if signedDragProgress != 0 { signedDragProgress = 0 }
    }
}

// MARK: - Adaptive-chrome opacity

/// Pure function: given the current page index, live signed drag
/// progress, and live hero scroll offset, return the photo / canopy
/// opacity for the calm-hero crossfades.
///
/// Extracted so `GlobalPhotoLayer` and `BriefingCanopyOverlay` share
/// the EXACT same opacity curve — any divergence would produce a
/// visible mismatch where the photo and canopy fade out of sync. By
/// routing both through one function, "match the photo's fade" is
/// enforced by construction.
///
/// The "effective page" is `currentPage + signedDragProgress` —
/// i.e., where the user is effectively pointing during a swipe, not
/// just where the last commit landed them. How close that is to
/// Today's index (2) is the photo's visibility. Multiplied by the
/// Today vertical-scroll factor so scrolling past the hero also
/// fades the photo out.
///
/// Pure, not isolated to `@MainActor`, so unit tests can call it
/// directly with synthetic inputs.
enum AdaptiveChromeOpacity {
    /// The Today page's index in the pager. Defined here (and read
    /// here only) so the math is self-contained — `MainContainer`
    /// already documents the ordering at `currentPage`.
    static let todayIndex: Double = 2

    /// Distance (in points) over which the photo fades out as the
    /// user scrolls Today's hero downward. Matches the value in
    /// `MainContainer.heroFadeDistance`; kept as a parameter rather
    /// than a constant so callers can supply the same source of
    /// truth.
    static func compute(
        currentPage: Int,
        signedDragProgress: CGFloat,
        heroScrollOffset: CGFloat,
        heroFadeDistance: CGFloat
    ) -> Double {
        let effectivePage = Double(currentPage) + Double(signedDragProgress)
        let distanceFromToday = abs(effectivePage - Self.todayIndex)
        let proximityToToday = max(0, 1 - distanceFromToday)
        let scrollFactor: Double = currentPage == Int(Self.todayIndex)
            ? 1 - min(max(Double(heroScrollOffset / heroFadeDistance), 0), 1)
            : 1.0
        return proximityToToday * scrollFactor
    }
}
