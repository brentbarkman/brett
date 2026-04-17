import SwiftUI
import UIKit

/// Snapshot of the user's accessibility preferences at a point in time.
///
/// Use `AccessibilityEnv.current()` for a runtime read (e.g. when deciding
/// whether to queue a haptic animation off the main thread) and the
/// `@Environment` keys inside SwiftUI views for reactive updates.
///
/// Values that come from `UIAccessibility` must be read on the main actor
/// because UIKit publishes them on the main run loop. `dynamicTypeSize` is
/// derived from the SwiftUI environment and not tied to UIKit globals, so we
/// capture it separately from a view-local `@Environment`.
struct AccessibilityEnv: Equatable, Sendable {
    var isVoiceOverRunning: Bool
    var isReduceMotionEnabled: Bool
    var isIncreaseContrastEnabled: Bool
    var dynamicTypeSize: DynamicTypeSize

    /// Default "no accommodations" snapshot, used as a safe fallback when we
    /// can't synchronously read the main-actor UIAccessibility globals (e.g.
    /// from a background context). Callers that need accurate values should
    /// use `currentSync()` on the main actor or `current()` with `await`.
    static let neutral = AccessibilityEnv(
        isVoiceOverRunning: false,
        isReduceMotionEnabled: false,
        isIncreaseContrastEnabled: false,
        dynamicTypeSize: .large
    )

    /// Snapshot the UIAccessibility globals on the main actor.
    ///
    /// - Parameter dynamicTypeSize: pass the view's `@Environment(\.dynamicTypeSize)`
    ///   when calling from inside a view. Defaults to `.large` when unknown.
    @MainActor
    static func current(dynamicTypeSize: DynamicTypeSize = .large) -> AccessibilityEnv {
        AccessibilityEnv(
            isVoiceOverRunning: UIAccessibility.isVoiceOverRunning,
            isReduceMotionEnabled: UIAccessibility.isReduceMotionEnabled,
            isIncreaseContrastEnabled: UIAccessibility.isDarkerSystemColorsEnabled,
            dynamicTypeSize: dynamicTypeSize
        )
    }
}

// MARK: - SwiftUI environment helpers

/// View-side helper that reads the live SwiftUI environment values for
/// accessibility preferences and wraps them up as an `AccessibilityEnv`.
///
/// Usage:
/// ```swift
/// struct MyView: View {
///     @AccessibilitySnapshot private var a11y
///     var body: some View { ... }
/// }
/// ```
///
/// Declared as a property wrapper so tests can stub it without spinning up a
/// real SwiftUI view graph.
@propertyWrapper
struct AccessibilitySnapshot: DynamicProperty {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityDifferentiateWithoutColor) private var diffWithoutColor
    @Environment(\.colorSchemeContrast) private var colorSchemeContrast
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var wrappedValue: AccessibilityEnv {
        AccessibilityEnv(
            isVoiceOverRunning: UIAccessibility.isVoiceOverRunning,
            isReduceMotionEnabled: reduceMotion,
            // Treat SwiftUI's `.increased` contrast signal as the user-facing
            // "Increase Contrast" toggle. `differentiateWithoutColor` is a
            // related but distinct preference we surface on demand.
            isIncreaseContrastEnabled: colorSchemeContrast == .increased
                || diffWithoutColor,
            dynamicTypeSize: dynamicTypeSize
        )
    }
}
