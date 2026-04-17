import SwiftUI

/// Reusable scroll-offset tracker. A view (usually a `ScrollView`'s content
/// root) reports its offset via `.trackScrollOffset(tracker:)` and other
/// views (background images, headers) can observe the value to produce
/// parallax or sticky effects.
///
/// Uses `@Observable` so downstream views only re-render when the tracked
/// value changes.
@MainActor
@Observable
final class ScrollOffsetTracker {
    /// Current vertical scroll offset in points. Negative when the content
    /// is pulled down (rubber-band at the top).
    var offsetY: CGFloat = 0
}

private struct ScrollOffsetPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

extension View {
    /// Publish this view's vertical offset inside a `ScrollView` to
    /// `tracker`. Typically applied to the scroll content root.
    func trackScrollOffset(tracker: ScrollOffsetTracker) -> some View {
        background(
            GeometryReader { geo in
                Color.clear
                    .preference(
                        key: ScrollOffsetPreferenceKey.self,
                        value: geo.frame(in: .named("brettScroll")).minY
                    )
            }
        )
        .onPreferenceChange(ScrollOffsetPreferenceKey.self) { value in
            // Hop to MainActor so we can mutate the @Observable tracker.
            Task { @MainActor in
                tracker.offsetY = value
            }
        }
    }
}

/// Applies a parallax translate to a background: the background moves at
/// `strength × scroll offset` so it visually lags the foreground content.
///
/// A `strength` of `0.5` gives the 0.5× parallax called out in the redesign
/// spec — the background appears to move at half the speed of the scrolling
/// content.
///
/// Reduce Motion short-circuits to no translation. The background stays put.
struct ParallaxBackgroundModifier: ViewModifier {
    /// Tracker publishing the current scroll offset in points.
    var tracker: ScrollOffsetTracker

    /// Fraction of the scroll delta to apply as a translate.
    /// `0` = no movement, `1` = moves exactly with the content.
    var strength: CGFloat = 0.5

    func body(content: Content) -> some View {
        let reduceMotion = BrettAnimation.isReduceMotionEnabled
        // Offset is negative when the content scrolls up, so we multiply by
        // strength directly; the background shifts upward at a slower rate.
        let translation = reduceMotion ? 0 : tracker.offsetY * strength
        content
            .offset(y: translation)
    }
}

extension View {
    /// Apply a parallax translate to this background view. The caller is
    /// responsible for updating `tracker` via `.trackScrollOffset(tracker:)`
    /// on the foreground scroll content and wrapping the scroll view in
    /// `.coordinateSpace(name: "brettScroll")`.
    ///
    /// Example:
    /// ```swift
    /// ZStack {
    ///     BackgroundView()
    ///         .parallaxBackground(tracker: tracker)
    ///     ScrollView {
    ///         Content()
    ///             .trackScrollOffset(tracker: tracker)
    ///     }
    ///     .coordinateSpace(name: "brettScroll")
    /// }
    /// ```
    func parallaxBackground(
        tracker: ScrollOffsetTracker,
        strength: CGFloat = 0.5
    ) -> some View {
        modifier(ParallaxBackgroundModifier(tracker: tracker, strength: strength))
    }
}
