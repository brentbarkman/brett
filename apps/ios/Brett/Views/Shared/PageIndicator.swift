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
        .accessibilityLabel(Text("Page \(currentIndex + 1) of \(pages.count)"))
    }

    /// Spring used for dot transitions. Falls through to `nil` (instant) when
    /// Reduce Motion is enabled.
    private var indicatorAnimation: Animation? {
        BrettAnimation.respectingReduceMotion(BrettAnimation.springBouncy)
    }
}
