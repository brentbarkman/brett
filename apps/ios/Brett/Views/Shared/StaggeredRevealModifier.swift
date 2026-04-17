import SwiftUI

/// Opacity + translateY entrance animation that cascades across a list of
/// sibling views.
///
/// Each child calls `.staggeredReveal(index:triggered:)` with its position in
/// the list. When `triggered` flips to `true` the child fades in and settles
/// from 8 pt below its final position, delayed by `index × staggerDelay`.
///
/// Honors Reduce Motion: the modifier short-circuits to an instantly-visible
/// view with no delay or translation.
struct StaggeredRevealModifier: ViewModifier {
    /// Zero-based position within the reveal group. Controls the per-child
    /// delay so later children start later.
    let index: Int

    /// When `false` the child stays in its pre-reveal state (offset + faded)
    /// so the caller can flip to `true` as the surface appears.
    let triggered: Bool

    /// Per-child delay in seconds. Defaults to 30 ms, matching the spec's
    /// tighter stagger for list rows. Section cards use 100 ms via the
    /// morning-ritual modifier.
    var staggerDelay: Double = 0.03

    /// Duration of each child's own fade/slide. 300 ms matches the redesign
    /// spec.
    var duration: Double = 0.3

    /// Vertical distance (pt) the child translates from. Positive values
    /// slide up into position.
    var translationY: CGFloat = 8

    func body(content: Content) -> some View {
        let reduceMotion = BrettAnimation.isReduceMotionEnabled
        let delay = reduceMotion ? 0 : Double(index) * staggerDelay
        let animation: Animation? = reduceMotion
            ? nil
            : .easeOut(duration: duration).delay(delay)

        return content
            .opacity(triggered ? 1 : 0)
            .offset(y: (triggered || reduceMotion) ? 0 : translationY)
            .animation(animation, value: triggered)
    }
}

extension View {
    /// Apply a staggered fade + slide-up entrance. See
    /// ``StaggeredRevealModifier`` for details.
    ///
    /// - Parameters:
    ///   - index: Zero-based position in the reveal group.
    ///   - triggered: Flip to `true` to play the animation.
    ///   - staggerDelay: Optional override for the per-child delay.
    func staggeredReveal(
        index: Int,
        triggered: Bool,
        staggerDelay: Double = 0.03
    ) -> some View {
        modifier(
            StaggeredRevealModifier(
                index: index,
                triggered: triggered,
                staggerDelay: staggerDelay
            )
        )
    }
}
