import SwiftUI

/// Brief gold shadow pulse triggered when `trigger` changes.
///
/// Used to punctuate meaningful completions — toggling a task done, applying
/// a quick-schedule date, etc. The pulse is short (≤400 ms) and non-blocking:
/// the underlying view stays fully interactive throughout.
///
/// ```swift
/// TaskRow(...)
///     .goldPulse(trigger: completionCount)
/// ```
struct GoldPulseModifier<Trigger: Equatable>: ViewModifier {
    let trigger: Trigger

    /// 0 → no pulse, 1 → peak. Driven by `.animation` on `trigger` change.
    @State private var intensity: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .shadow(
                color: BrettColors.gold.opacity(0.60 * intensity),
                radius: 18 * intensity,
                x: 0,
                y: 0
            )
            .shadow(
                color: BrettColors.gold.opacity(0.35 * intensity),
                radius: 6 * intensity,
                x: 0,
                y: 0
            )
            .onChange(of: trigger) { _, _ in
                // Snap up fast, fade out smoothly — total duration ≤ 400ms.
                withAnimation(.easeOut(duration: 0.08)) {
                    intensity = 1
                }
                withAnimation(.easeOut(duration: 0.32).delay(0.08)) {
                    intensity = 0
                }
            }
    }
}

extension View {
    /// Emits a short gold glow whenever `trigger` changes.
    /// Total pulse duration is capped at ~400 ms per the design spec.
    func goldPulse<T: Equatable>(trigger: T) -> some View {
        modifier(GoldPulseModifier(trigger: trigger))
    }
}
