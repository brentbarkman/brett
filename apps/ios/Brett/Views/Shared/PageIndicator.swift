import SwiftUI

/// Paging dot indicator used in `MainContainer` to show Inbox / Today /
/// Calendar position.
///
/// Active dot morphs from a 5 pt circle into a wider 14 × 7 gold "pill" with
/// spring physics. Inactive dots hold as faint white circles. Reduce Motion
/// collapses the transition to an instant state swap.
struct PageIndicator: View {
    let pages: [String]
    let currentIndex: Int
    /// Optional hook for VoiceOver's adjustable action (rotor swipe up/down).
    /// When `nil` the indicator stays read-only.
    var onAdjust: ((AccessibilityAdjustmentDirection) -> Void)? = nil

    /// Width/height of inactive dots.
    private let dotSize: CGFloat = 5
    /// Width of the active pill.
    private let activeWidth: CGFloat = 14
    /// Height of the active pill.
    private let activeHeight: CGFloat = 7

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(pages.enumerated()), id: \.offset) { index, _ in
                let isActive = index == currentIndex
                Capsule()
                    .fill(isActive ? BrettColors.gold : Color.white.opacity(0.25))
                    .frame(
                        width: isActive ? activeWidth : dotSize,
                        height: isActive ? activeHeight : dotSize
                    )
                    .animation(indicatorAnimation, value: currentIndex)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(accessibilityLabel))
        .accessibilityAdjustableAction { direction in
            onAdjust?(direction)
        }
    }

    /// Reads as e.g. "Today, page 2 of 3" — pairs the positional info with
    /// the human-friendly page name so VoiceOver users know *where* they are,
    /// not just *which index* they're on.
    private var accessibilityLabel: String {
        guard !pages.isEmpty else { return "Page indicator" }
        let clamped = max(0, min(currentIndex, pages.count - 1))
        return AccessibilityLabels.pageIndicator(
            current: clamped + 1,
            total: pages.count,
            name: pages[clamped]
        )
    }

    /// Spring used for dot transitions. Falls through to `nil` (instant) when
    /// Reduce Motion is enabled.
    private var indicatorAnimation: Animation? {
        BrettAnimation.respectingReduceMotion(BrettAnimation.springBouncy)
    }
}
