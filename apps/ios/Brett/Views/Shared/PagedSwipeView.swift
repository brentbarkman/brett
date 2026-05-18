import SwiftUI
import UIKit

/// Horizontal pager built on `UIPageViewController` so we can read
/// real-time swipe progress (something SwiftUI's `TabView(.page)`
/// doesn't expose). Drives the calm-hero photo crossfade: as the user
/// drags Today off-screen toward Inbox, `signedDragProgress` ramps
/// from 0 toward ±1, and the photo's opacity fades in lockstep — no
/// snap at midpoint, no snap at commit, no top/bottom safe-area lag.
///
/// Three bindings:
/// - `selection` — current page index (0…pageCount-1). Settles after
///   the swipe completes; updating it programmatically also flips the
///   page (for tap-to-switch on the view-pills row). The coordinator
///   bumps `selection` proactively at the moment UIPageViewController
///   resets its inner scroll offset (see `prevOffsetX`) so consumers
///   see the post-commit values one frame earlier — without that
///   bump, opacity snaps from its release-moment value to the
///   committed value when `didFinishAnimating` fires.
/// - `dragProgress` — magnitude 0…1 of how far the user has dragged
///   from the current page toward an adjacent one. Always non-negative.
/// - `signedDragProgress` — same magnitude, signed -1…+1. Positive
///   when the user drags toward a HIGHER index (next page); negative
///   toward a LOWER index. Lets callers compute "where is the user
///   effectively pointing" for crossfades that need direction.
///
/// Implementation is deliberately small. `UIPageViewController` exposes
/// its inner scroll view via `view.subviews` (the only `UIScrollView`
/// in the hierarchy); `Coordinator` becomes its delegate to track
/// `contentOffset.x`. When the offset = pageWidth the pager is
/// centered; offsets either side give us signed swipe distance.
struct PagedSwipeView<Page: View>: UIViewControllerRepresentable {
    let pageCount: Int
    @Binding var selection: Int
    /// Magnitude 0…1.
    @Binding var dragProgress: CGFloat
    /// Signed -1…+1. Positive when the user drags toward a HIGHER
    /// index (next page); negative toward a LOWER index. Lets
    /// callers compute "where is the user effectively pointing"
    /// for crossfades that need direction (e.g. fading the global
    /// photo only while moving away from Today).
    @Binding var signedDragProgress: CGFloat
    @ViewBuilder let pageBuilder: (Int) -> Page

    func makeUIViewController(context: Context) -> UIPageViewController {
        let pvc = UIPageViewController(
            transitionStyle: .scroll,
            navigationOrientation: .horizontal,
            options: nil
        )
        pvc.dataSource = context.coordinator
        pvc.delegate = context.coordinator
        // Initial page — routed through the coordinator's cache so
        // subsequent dataSource queries return the same instance.
        pvc.setViewControllers(
            [context.coordinator.makePage(for: selection)],
            direction: .forward,
            animated: false
        )
        // Find the inner UIScrollView so we can observe offset for
        // real-time swipe progress. It's always the only scroll view
        // in the hierarchy at this depth — established UIKit pattern.
        DispatchQueue.main.async {
            for view in pvc.view.subviews {
                if let scroll = view as? UIScrollView {
                    scroll.delegate = context.coordinator
                    context.coordinator.scrollView = scroll
                    return
                }
            }
        }
        return pvc
    }

    func updateUIViewController(_ pvc: UIPageViewController, context: Context) {
        // Hard guard: never call `setViewControllers` while the inner
        // scroll view is mid-swipe (dragging) or settling
        // (decelerating). Without this, every SwiftUI body re-render
        // during a swipe (driven by our own dragProgress @State
        // updates) was racing the pager's own animation and snapping
        // it back to the original page — the user-visible "swipe
        // bounces back at 75%" bug.
        if let scroll = context.coordinator.scrollView,
           scroll.isDragging || scroll.isDecelerating || scroll.isTracking {
            return
        }
        guard let current = pvc.viewControllers?.first as? PageHost,
              current.index != selection
        else { return }
        let direction: UIPageViewController.NavigationDirection =
            selection > current.index ? .forward : .reverse
        pvc.setViewControllers(
            [context.coordinator.makePage(for: selection)],
            direction: direction,
            animated: true
        )
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject,
                             UIPageViewControllerDataSource,
                             UIPageViewControllerDelegate,
                             UIScrollViewDelegate {
        var parent: PagedSwipeView
        weak var scrollView: UIScrollView?
        /// Cache of `PageHost` instances by index. UIPageViewController
        /// queries the data source repeatedly during a swipe (and
        /// during its commit/cancel decision); returning a fresh VC
        /// each time was confusing its pointer-equality checks and
        /// causing swipes to bounce back even past the midpoint.
        private var hostCache: [Int: PageHost] = [:]

        /// Previous scroll-view contentOffset.x, sampled on every
        /// `scrollViewDidScroll`. Used to detect the page-commit
        /// discontinuity: UIPageViewController resets its inner scroll
        /// offset by one pageWidth in a single frame when a page change
        /// commits (offset jumps from ~0 or ~2·pageWidth back to
        /// pageWidth in the new 3-page window). At that frame we bump
        /// `selection` ourselves so the next live-progress publish
        /// computes against the correct `currentPage` — instead of
        /// freezing progress during settle, which produced the visible
        /// snap-at-commit the user reported.
        ///
        /// `nil` between gestures so the first scroll callback after a
        /// fresh gesture doesn't compare against a stale baseline from
        /// the previous swipe. Also `nil`ed on pageWidth change
        /// (rotation / split-view resize) — without that, a pre-rotation
        /// baseline in old-pageWidth coordinates can falsely satisfy
        /// the half-page jump threshold against the new pageWidth.
        private var prevOffsetX: CGFloat?

        /// Last observed pageWidth. Used to invalidate `prevOffsetX`
        /// when the scrollview's bounds change (rotation / size
        /// class). Without this guard, rotation-time offset shifts
        /// can spuriously trigger the page-commit reset detection
        /// and bump `selection` to a neighbour the user never
        /// reached.
        private var lastPageWidth: CGFloat = 0

        init(_ parent: PagedSwipeView) { self.parent = parent }

        // MARK: DataSource — returns adjacent pages on demand.

        func pageViewController(
            _ pvc: UIPageViewController,
            viewControllerBefore vc: UIViewController
        ) -> UIViewController? {
            guard let host = vc as? PageHost, host.index > 0 else { return nil }
            return makePage(for: host.index - 1)
        }

        func pageViewController(
            _ pvc: UIPageViewController,
            viewControllerAfter vc: UIViewController
        ) -> UIViewController? {
            guard let host = vc as? PageHost,
                  host.index < parent.pageCount - 1 else { return nil }
            return makePage(for: host.index + 1)
        }

        /// Returns a stable PageHost per index — cached so multiple
        /// dataSource queries during a single swipe receive the
        /// same UIViewController instance. Without this,
        /// UIPageViewController's transition state machine got
        /// confused and bounced near-completed swipes back.
        func makePage(for index: Int) -> PageHost {
            if let cached = hostCache[index] { return cached }
            let host = PageHost(rootView: AnyView(parent.pageBuilder(index)))
            host.index = index
            host.view.backgroundColor = .clear
            hostCache[index] = host
            return host
        }

        // MARK: Delegate — settles the selection after a swipe.

        func pageViewController(
            _ pvc: UIPageViewController,
            didFinishAnimating finished: Bool,
            previousViewControllers: [UIViewController],
            transitionCompleted: Bool
        ) {
            DispatchQueue.main.async {
                if transitionCompleted,
                   let current = pvc.viewControllers?.first as? PageHost {
                    // Atomic: update selection AND reset progress in
                    // one runloop tick so consumers don't see a
                    // stale-page-with-zero-progress frame (which
                    // briefly blanked the photo when swiping back
                    // toward Today).
                    if self.parent.selection != current.index {
                        self.parent.selection = current.index
                    }
                }
                if self.parent.dragProgress != 0 {
                    self.parent.dragProgress = 0
                }
                if self.parent.signedDragProgress != 0 {
                    self.parent.signedDragProgress = 0
                }
            }
        }

        // MARK: ScrollView — feeds swipe progress in real time.

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            // Publish live progress for both finger-on-screen drag AND
            // the post-release settle. The earlier `isTracking`-only
            // guard froze progress at the release-moment value and
            // produced a visible "opacity snaps to the committed value
            // when the pager finishes settling" — see the rewrite note
            // on `prevOffsetX`. Programmatic transitions (tap-to-switch
            // via ViewPillsBar) leave both flags false, so they're
            // still skipped — those snap via the `withAnimation` spring
            // on `currentPage` at the tap site.
            guard scrollView.isTracking || scrollView.isDecelerating else {
                prevOffsetX = nil
                return
            }
            let pageWidth = scrollView.bounds.width
            guard pageWidth > 0 else { return }

            // Invalidate the prev baseline if pageWidth changed —
            // rotation / size class. See `lastPageWidth`'s doc.
            if pageWidth != lastPageWidth {
                prevOffsetX = nil
                lastPageWidth = pageWidth
            }

            let currentOffset = scrollView.contentOffset.x

            // Page-commit reset detection. When the user's swipe
            // commits, UIPageViewController:
            //   1. Settles the inner scroll to ~0 or ~2·pageWidth
            //      (the adjacent page's slot).
            //   2. In ONE frame, reorganises its 3-page window so the
            //      new page is centered, which yanks the contentOffset
            //      back to pageWidth.
            //   3. Fires `didFinishAnimating` shortly after.
            //
            // The frame between (1) and (2) is the snap source: from
            // the consumer's perspective, `signedDragProgress` lurches
            // from ±~1 back to 0 while `selection` still reflects the
            // OLD centered page. If we publish that frame, the photo
            // opacity drops to the old page's value (0 if committing
            // away from Today) for one frame, then jumps back when
            // `didFinishAnimating` commits the new selection.
            //
            // Detection: a single-frame contentOffset movement of more
            // than half a pageWidth. No human finger can drag that
            // fast, and UIScrollView's settle animation never advances
            // more than a fraction of a page in 16ms — the only thing
            // that produces a half-page jump in a frame is the UIPV
            // window-reorganisation. When we see it, bump `selection`
            // ourselves (direction from the SIGN of the previous
            // delta — forward commits settle through +1, backward
            // through -1). The immediately-following publish then
            // lands `effectivePage = newPage + 0 = newPage`, matching
            // the visible state. `didFinishAnimating` becomes a
            // no-op for selection because the existing
            // `if self.parent.selection != current.index` guard
            // short-circuits.
            if let bump = PagedSwipeResetDetector.bumpForReset(
                prevOffset: prevOffsetX,
                currentOffset: currentOffset,
                pageWidth: pageWidth
            ) {
                let proposed = self.parent.selection + bump
                if proposed >= 0 && proposed < self.parent.pageCount {
                    self.parent.selection = proposed
                    // Reset progress in the same tick — the centered
                    // offset's signed = 0 is the value the next frame
                    // would publish anyway, just made explicit so the
                    // consumer sees the atomic post-commit state in
                    // this tick rather than next.
                    if self.parent.dragProgress != 0 {
                        self.parent.dragProgress = 0
                    }
                    if self.parent.signedDragProgress != 0 {
                        self.parent.signedDragProgress = 0
                    }
                    prevOffsetX = currentOffset
                    return
                }
                // Out-of-bounds bump (e.g. edge bounce that crossed
                // the threshold). Don't mutate selection; fall through
                // to a normal publish so progress still tracks the
                // observed offset truthfully.
            }
            prevOffsetX = currentOffset

            let delta = currentOffset - pageWidth
            let signed = max(-1, min(1, delta / pageWidth))
            let magnitude = min(1, abs(delta) / pageWidth)
            if abs(self.parent.dragProgress - magnitude) > 0.001 {
                self.parent.dragProgress = magnitude
            }
            if abs(self.parent.signedDragProgress - signed) > 0.001 {
                self.parent.signedDragProgress = signed
            }
        }

        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
            // Safety reset in case `didFinishAnimating` missed a
            // tiny rounding tail. Selection is left alone here —
            // the delegate path (and the in-scroll bump above) are
            // the sources of truth for that.
            prevOffsetX = nil
            DispatchQueue.main.async {
                if self.parent.dragProgress != 0 {
                    self.parent.dragProgress = 0
                }
                if self.parent.signedDragProgress != 0 {
                    self.parent.signedDragProgress = 0
                }
            }
        }
    }
}

/// `UIHostingController` subclass that carries its page index along
/// for the `UIPageViewControllerDataSource` queries.
final class PageHost: UIHostingController<AnyView> {
    var index: Int = 0
}

/// Pure threshold logic for detecting UIPageViewController's
/// window-reorganisation frame. Extracted from `PagedSwipeView`'s
/// `Coordinator` so the heuristic can be unit-tested without a live
/// `UIScrollView` / `UIPageViewController` harness — the rest of
/// the coordinator is too entangled with UIKit to test directly,
/// but this is where the behaviour the user notices actually lives.
///
/// Not generic, not nested inside `PagedSwipeView<Page>` — keeping
/// it at file scope means the test can call it without supplying a
/// `Page` type parameter that has no bearing on the logic.
enum PagedSwipeResetDetector {

    /// Returns the index bump (+1 or -1) the coordinator should
    /// apply when the inner scroll view's `contentOffset.x` moved by
    /// more than half a `pageWidth` in a single frame — the
    /// signature of UIPageViewController's window-reorganisation
    /// after a commit (see `PagedSwipeView.Coordinator.prevOffsetX`
    /// for the full rationale). Returns `nil` when:
    ///
    /// - `prevOffset` is `nil` (first callback of a gesture, or
    ///   after rotation/size-class change wiped the baseline).
    /// - The single-frame movement was less than `0.5 * pageWidth`
    ///   (normal drag / settle, no reset).
    /// - `pageWidth` is non-positive (degenerate layout).
    ///
    /// The caller still has to check the proposed
    /// `selection + bump` against `pageCount` bounds — an
    /// out-of-range bump means the detection fired falsely
    /// (e.g., an edge bounce or rotation we didn't catch) and
    /// the caller should fall through to a normal publish
    /// rather than mutate selection.
    static func bumpForReset(
        prevOffset: CGFloat?,
        currentOffset: CGFloat,
        pageWidth: CGFloat
    ) -> Int? {
        guard pageWidth > 0, let prev = prevOffset else { return nil }
        let movement = abs(currentOffset - prev)
        guard movement > 0.5 * pageWidth else { return nil }
        // Direction comes from the sign of the previous delta:
        // forward commits settle through +1·pageWidth before
        // resetting, backward through -1.
        let prevDelta = prev - pageWidth
        return prevDelta > 0 ? 1 : -1
    }
}
