import UIKit

/// Centralised haptic feedback.
///
/// Cached, `prepare()`-ed generators per Apple's recommendation — creating
/// one fresh on every call introduces several ms of latency which is
/// perceptible for quick gestures like swipes. All methods are `@MainActor`
/// because `UIFeedbackGenerator` must be driven from the main actor.
@MainActor
enum HapticManager {
    // MARK: - Cached generators

    private static let lightGen: UIImpactFeedbackGenerator = {
        let g = UIImpactFeedbackGenerator(style: .light)
        g.prepare()
        return g
    }()

    private static let mediumGen: UIImpactFeedbackGenerator = {
        let g = UIImpactFeedbackGenerator(style: .medium)
        g.prepare()
        return g
    }()

    private static let heavyGen: UIImpactFeedbackGenerator = {
        let g = UIImpactFeedbackGenerator(style: .heavy)
        g.prepare()
        return g
    }()

    private static let rigidGen: UIImpactFeedbackGenerator = {
        let g = UIImpactFeedbackGenerator(style: .rigid)
        g.prepare()
        return g
    }()

    private static let notificationGen: UINotificationFeedbackGenerator = {
        let g = UINotificationFeedbackGenerator()
        g.prepare()
        return g
    }()

    private static let selectionGen: UISelectionFeedbackGenerator = {
        let g = UISelectionFeedbackGenerator()
        g.prepare()
        return g
    }()

    // MARK: - Impact

    static func light() {
        lightGen.impactOccurred()
        lightGen.prepare()
    }

    static func medium() {
        mediumGen.impactOccurred()
        mediumGen.prepare()
    }

    static func heavy() {
        heavyGen.impactOccurred()
        heavyGen.prepare()
    }

    /// Short, stiff tap — good for "row lifts" on long-press drag.
    static func rigid() {
        rigidGen.impactOccurred()
        rigidGen.prepare()
    }

    // MARK: - Notification

    static func success() {
        notificationGen.notificationOccurred(.success)
        notificationGen.prepare()
    }

    static func warning() {
        notificationGen.notificationOccurred(.warning)
        notificationGen.prepare()
    }

    static func error() {
        notificationGen.notificationOccurred(.error)
        notificationGen.prepare()
    }

    // MARK: - Selection

    /// Fine-grained "a pickable value changed" tick — ideal for date
    /// scrollers, segmented selection, etc.
    static func selectionChanged() {
        selectionGen.selectionChanged()
        selectionGen.prepare()
    }
}
