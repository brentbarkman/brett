import Foundation
import Testing
@testable import Brett

/// Coverage for `PagedSwipeView.bumpForReset` — the pure threshold
/// logic that detects UIPageViewController's window-reorganisation
/// frame. When the inner scroll view's contentOffset.x jumps by more
/// than half a pageWidth in a single frame, that's the moment the
/// pager committed a page change AND yanked the offset back to
/// pageWidth in the new 3-page window. The coordinator uses the
/// bump to update `selection` proactively so consumers don't see a
/// one-frame stale-page-with-zero-progress flash, which is the snap
/// the calm-hero photo opacity used to show at the end of every
/// side-swipe.
///
/// The detection is intentionally heuristic — UIPageViewController
/// doesn't expose the reset event directly — so the threshold has to
/// reject normal drag/settle motion (max ~one frame's worth of
/// movement, well under half a pageWidth) and accept the
/// reset discontinuity (exactly one pageWidth in zero frames).
@Suite("PagedSwipeReset")
struct PagedSwipeResetDetectionTests {

    /// Forward commit: previous frame had the offset settled near
    /// the next-page slot (offset ≈ 2·pageWidth, prevDelta ≈ +1),
    /// current frame has the offset reset back to pageWidth. That
    /// pageWidth-magnitude jump in one frame is the signature.
    @Test func forwardCommitProducesPositiveBump() {
        let pageWidth: CGFloat = 400
        let prev: CGFloat = 800   // ≈ 2·pageWidth (forward boundary)
        let current: CGFloat = 400 // ≈ pageWidth (centered)
        #expect(PagedSwipeResetDetector.bumpForReset(
            prevOffset: prev,
            currentOffset: current,
            pageWidth: pageWidth
        ) == 1)
    }

    /// Backward commit mirrors forward — prevDelta < 0, expect -1.
    @Test func backwardCommitProducesNegativeBump() {
        let pageWidth: CGFloat = 400
        let prev: CGFloat = 0      // ≈ 0 (backward boundary)
        let current: CGFloat = 400 // ≈ pageWidth (centered)
        #expect(PagedSwipeResetDetector.bumpForReset(
            prevOffset: prev,
            currentOffset: current,
            pageWidth: pageWidth
        ) == -1)
    }

    /// Normal mid-swipe motion: a couple of percent of a page per
    /// frame at most. Must never satisfy the threshold or we'd bump
    /// selection mid-drag and snap the photo to a neighbouring
    /// page's wallpaper.
    @Test func normalDragMotionDoesNotBump() {
        let pageWidth: CGFloat = 400
        let prev: CGFloat = 380     // halfway into a leftward drag
        let current: CGFloat = 360  // 20pt further left (5% of page)
        #expect(PagedSwipeResetDetector.bumpForReset(
            prevOffset: prev,
            currentOffset: current,
            pageWidth: pageWidth
        ) == nil)
    }

    /// Settle-back-to-center after a cancelled swipe: offset moves
    /// gradually from, say, 0.3·pageWidth back to pageWidth across
    /// many frames. Each per-frame step is small even on a fast
    /// release. Verify a single step inside that settle doesn't
    /// trigger the detection.
    @Test func cancelledSwipeSettleDoesNotBump() {
        let pageWidth: CGFloat = 400
        // Frame in the middle of a cancel-settle: offset moving back
        // from 280 toward pageWidth=400. ~40pt per-frame step is on
        // the fast end of UIScrollView's spring deceleration.
        let prev: CGFloat = 280
        let current: CGFloat = 320
        #expect(PagedSwipeResetDetector.bumpForReset(
            prevOffset: prev,
            currentOffset: current,
            pageWidth: pageWidth
        ) == nil)
    }

    /// First scroll callback of a gesture — coordinator clears
    /// `prevOffsetX` between gestures so the first comparison has no
    /// baseline. Must return nil (no bump, no false positive).
    @Test func nilPrevOffsetReturnsNil() {
        #expect(PagedSwipeResetDetector.bumpForReset(
            prevOffset: nil,
            currentOffset: 400,
            pageWidth: 400
        ) == nil)
    }

    /// Degenerate layout (pre-layout pass, zero-width container).
    /// Must return nil rather than divide-by-zero or accept any
    /// motion as a reset.
    @Test func zeroPageWidthReturnsNil() {
        #expect(PagedSwipeResetDetector.bumpForReset(
            prevOffset: 0,
            currentOffset: 100,
            pageWidth: 0
        ) == nil)
        #expect(PagedSwipeResetDetector.bumpForReset(
            prevOffset: 0,
            currentOffset: 100,
            pageWidth: -10
        ) == nil)
    }

    /// Threshold is strictly greater-than half a pageWidth. Exactly
    /// 50% does NOT bump — that protects against a hypothetical
    /// pathological settle that hits the half-page line without an
    /// actual reset.
    @Test func exactlyHalfPageMovementDoesNotBump() {
        let pageWidth: CGFloat = 400
        // movement = |600 - 400| = 200 = 0.5·400, NOT > 0.5
        #expect(PagedSwipeResetDetector.bumpForReset(
            prevOffset: 400,
            currentOffset: 600,
            pageWidth: pageWidth
        ) == nil)
    }

    /// Just past half-page movement bumps — covers the fast-flick
    /// case where the frame before the reset may not have reached
    /// the full ±pageWidth boundary before UIPV committed.
    @Test func justOverHalfPageMovementBumps() {
        let pageWidth: CGFloat = 400
        // Hypothetical fast-flick: prev was at 0.4·pageWidth past
        // centered (delta = +160), current snapped back to centered.
        // Movement = 240 > 200. Bump = +1 (prevDelta > 0).
        #expect(PagedSwipeResetDetector.bumpForReset(
            prevOffset: 560,
            currentOffset: 320,
            pageWidth: pageWidth
        ) == 1)
    }
}
