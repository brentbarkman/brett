import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Centralized motion tokens for Brett iOS.
///
/// All on-screen animations should resolve through these constants so easing,
/// duration, and damping stay consistent across the app. When the user has
/// Reduce Motion enabled, prefer `respectingReduceMotion(_:)` so callers opt
/// out of motion in one place.
///
/// Tokens are grouped by intent:
///   - `quick` / `standard` / `slow` — flat easing curves for simple fades.
///   - `spring*` — spring physics for interactive or celebratory motion.
///   - `pageTransition` / `completionCascade` — named presets for specific
///     high-visibility flows described in the native iOS redesign spec.
enum BrettAnimation {
    // MARK: - Easing presets

    /// 150 ms ease-out. Use for small, atomic state changes (checkbox fills,
    /// border flashes) where the animation should feel instantaneous.
    static let quick: Animation = .easeOut(duration: 0.15)

    /// 250 ms ease-in-out. Default for layout changes, fades, and anything
    /// where the motion should feel "noticeable but not showy".
    static let standard: Animation = .easeInOut(duration: 0.25)

    /// 400 ms ease-out. Use for dismissals and for trailing portions of
    /// composite animations (e.g. header pulse after a task completion).
    static let slow: Animation = .easeOut(duration: 0.4)

    // MARK: - Spring presets

    /// Bouncy, lively spring. Good for celebratory motion (task completion
    /// flourish, spotlight reveals).
    static let springBouncy: Animation = .spring(response: 0.5, dampingFraction: 0.7)

    /// Calm spring. Default for list reflows and structural rearrangements.
    static let springCalm: Animation = .spring(response: 0.4, dampingFraction: 0.9)

    /// Firm spring with no overshoot. Use for settling animations where we
    /// want snap without any bounce.
    static let springFirm: Animation = .spring(response: 0.3, dampingFraction: 1.0)

    // MARK: - Named flows

    /// Horizontal paging between Inbox / Today / Calendar.
    static let pageTransition: Animation = .spring(response: 0.45, dampingFraction: 0.85)

    /// Task row completion cascade — slide + fade into the Done section.
    static let completionCascade: Animation = .spring(response: 0.5, dampingFraction: 0.8)

    // MARK: - Reduce motion

    /// Returns `animation` when motion is allowed, or `nil` when Reduce
    /// Motion is enabled on the device. Attaching a `nil` animation
    /// effectively disables motion so the state change becomes instant.
    ///
    /// Prefer this for any stagger, translate, or spring — fades (opacity)
    /// are still acceptable with Reduce Motion, but callers that wrap
    /// motion-heavy transitions should funnel through here.
    ///
    /// Must be called from the main actor — `UIAccessibility` state is
    /// published on the main run loop.
    @MainActor
    static func respectingReduceMotion(_ animation: Animation) -> Animation? {
        isReduceMotionEnabled ? nil : animation
    }

    /// Convenience accessor for the system Reduce Motion preference.
    ///
    /// Exposed so tests and view-models can branch on the flag without
    /// importing `UIKit`. Tests that want to simulate a given value should
    /// prefer injecting `isReduceMotionEnabled` through a wrapper rather
    /// than flipping the real system setting.
    ///
    /// Must be read from the main actor — `UIAccessibility` is main-actor
    /// isolated under Swift 6. Non-UI callers (background work, view
    /// models) should capture the value once from a main-actor context
    /// and pass it through.
    @MainActor
    static var isReduceMotionEnabled: Bool {
        #if canImport(UIKit)
        return UIAccessibility.isReduceMotionEnabled
        #else
        return false
        #endif
    }
}
