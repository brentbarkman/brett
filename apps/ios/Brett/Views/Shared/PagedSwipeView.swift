import SwiftUI
import UIKit

/// Horizontal pager built on `UIPageViewController` so we can read
/// real-time swipe progress (something SwiftUI's `TabView(.page)`
/// doesn't expose). Drives the calm-hero photo crossfade: as the user
/// drags Today off-screen toward Inbox, `dragProgress` ramps from 0
/// toward 1, and the photo's opacity fades in lockstep — no snap at
/// midpoint, no top/bottom safe-area lag.
///
/// Three bindings:
/// - `selection` — current page index (0…pageCount-1). Settles after
///   the swipe completes; updated programmatically also flips the page
///   (for tap-to-switch on the view-pills row).
/// - `dragProgress` — magnitude 0…1 of how far the user has dragged
///   from the current page toward an adjacent one. Always non-negative.
/// - `dragSource` — which page the user is dragging FROM. Stays at the
///   most recent settled page until the next swipe completes; lets
///   callers compute "is the user dragging away from Today?" without
///   lookups.
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
            // Only feed live drag progress while the user's finger is
            // on the screen. Once they release, we let the pager's
            // settle animation play out and rely on
            // `didFinishAnimating` to atomically update both
            // `selection` and progress — without this guard, the
            // settling scroll resets progress to 0 BEFORE selection
            // catches up, which produced a one-frame flash on swipe-
            // back to Today.
            guard scrollView.isTracking else { return }
            let pageWidth = scrollView.bounds.width
            guard pageWidth > 0 else { return }
            let delta = scrollView.contentOffset.x - pageWidth
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
            // the delegate path is the source of truth for that.
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
