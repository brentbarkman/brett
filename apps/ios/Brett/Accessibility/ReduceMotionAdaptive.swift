import SwiftUI

/// View modifier that collapses an animation when the user has enabled
/// Reduce Motion in Settings.
///
/// Usage:
/// ```swift
/// RoundedRectangle(cornerRadius: 12)
///     .opacity(isVisible ? 1 : 0)
///     .motionAware(.spring(response: 0.3, dampingFraction: 0.8), value: isVisible)
/// ```
///
/// When Reduce Motion is off: the supplied animation is applied normally.
/// When Reduce Motion is on: we fall back to a simple fade driven by
/// `.easeInOut` of the same duration, or no animation at all if the supplied
/// animation has a spring (which would otherwise overshoot).
struct ReduceMotionAdaptive<V: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var animation: Animation?
    var value: V

    func body(content: Content) -> some View {
        content.animation(effectiveAnimation, value: value)
    }

    private var effectiveAnimation: Animation? {
        guard reduceMotion else { return animation }
        // When reduce motion is on, swap spring/bounce curves for a plain
        // fade. A `nil` animation would snap instantly, which is also
        // acceptable per Apple HIG but can feel jarring on opacity changes —
        // a quick linear fade is safer.
        return .easeInOut(duration: 0.12)
    }
}

extension View {
    /// Respects the user's Reduce Motion preference. When enabled, the
    /// supplied animation is replaced with a short linear fade.
    func motionAware<V: Equatable>(
        _ animation: Animation?,
        value: V
    ) -> some View {
        modifier(ReduceMotionAdaptive(animation: animation, value: value))
    }

    /// Conditional transition wrapper — returns `.identity` when Reduce
    /// Motion is on so appearance/dismissal is instant, otherwise returns
    /// the supplied transition.
    ///
    /// Must be called inside a view with access to the SwiftUI environment
    /// (`@Environment(\.accessibilityReduceMotion)`). Callers typically wrap
    /// this inside a small helper view.
    func motionAwareTransition(
        _ transition: AnyTransition,
        reduceMotion: Bool
    ) -> some View {
        self.transition(reduceMotion ? .identity : transition)
    }
}
