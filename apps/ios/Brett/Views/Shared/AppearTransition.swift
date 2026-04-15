import SwiftUI

/// Reduce-motion-aware `AnyTransition` presets for Brett iOS.
///
/// Every preset short-circuits to a plain `.opacity` transition when the
/// device has Reduce Motion enabled, so motion-sensitive users still see
/// visual continuity but without slide/scale movement.
///
/// `@MainActor` because each getter reads `UIAccessibility.isReduceMotionEnabled`
/// through ``BrettAnimation``, which is main-actor isolated under Swift 6.
/// All SwiftUI view-body contexts are already on the main actor, so attaching
/// these transitions from a `View` doesn't require additional annotation.
@MainActor
extension AnyTransition {
    /// Fade + small upward slide (6 pt). Default for content that settles
    /// into place — task rows, toasts, inline banners.
    static var brettFadeSlide: AnyTransition {
        if BrettAnimation.isReduceMotionEnabled {
            return .opacity
        }
        return .asymmetric(
            insertion: .offset(y: 6).combined(with: .opacity),
            removal: .opacity
        )
    }

    /// Scale from 0.95 + fade. Use for modal-ish surfaces that should feel
    /// like they're "popping" from their anchor (Omnibar expand, detail
    /// sheet entry).
    static var brettScaleFade: AnyTransition {
        if BrettAnimation.isReduceMotionEnabled {
            return .opacity
        }
        return .asymmetric(
            insertion: .scale(scale: 0.95).combined(with: .opacity),
            removal: .opacity
        )
    }

    /// Slide from the trailing (right) edge. Use for paged content and
    /// forward navigation.
    static var brettSlideRight: AnyTransition {
        if BrettAnimation.isReduceMotionEnabled {
            return .opacity
        }
        return .asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .leading).combined(with: .opacity)
        )
    }

    /// Slide up from the bottom edge. Use for sheet-like surfaces that rise
    /// into view (voice mode expand, capture confirmation).
    static var brettSlideBottom: AnyTransition {
        if BrettAnimation.isReduceMotionEnabled {
            return .opacity
        }
        return .asymmetric(
            insertion: .move(edge: .bottom).combined(with: .opacity),
            removal: .opacity
        )
    }
}
