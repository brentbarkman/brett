import SwiftUI

/// View modifier that bumps visual weight when the user has enabled
/// "Increase Contrast" in Settings.
///
/// What changes:
///  - Glass material surfaces use `.regularMaterial` instead of `.thinMaterial`.
///  - A hairline border becomes more opaque.
///  - Text placed on glass shouldn't rely on subtle tinting — callers should
///    pair this with `.foregroundStyle(...)` adjustments where needed.
///
/// This is additive — we never remove glass, only thicken it. Views that
/// already look correct in default contrast stay visually identical there.
struct ContrastAdaptive: ViewModifier {
    @Environment(\.colorSchemeContrast) private var colorSchemeContrast
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor

    /// Optional corner radius — when provided we apply the material as a
    /// rounded rectangle background. When nil the caller is responsible for
    /// clipping.
    var cornerRadius: CGFloat?

    /// When true, also thickens the border (useful for cards). Default false.
    var addsBorder: Bool

    private var isHighContrast: Bool {
        colorSchemeContrast == .increased || differentiateWithoutColor
    }

    func body(content: Content) -> some View {
        content
            .background(materialBackground)
            .overlay(borderOverlay)
    }

    @ViewBuilder
    private var materialBackground: some View {
        let material: Material = isHighContrast ? .regularMaterial : .thinMaterial
        if let cornerRadius {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(material)
        } else {
            Rectangle().fill(material)
        }
    }

    @ViewBuilder
    private var borderOverlay: some View {
        if addsBorder {
            let strokeWidth: CGFloat = isHighContrast ? 1.5 : 0.5
            let strokeOpacity: Double = isHighContrast ? 0.45 : 0.12
            if let cornerRadius {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.white.opacity(strokeOpacity), lineWidth: strokeWidth)
            } else {
                Rectangle()
                    .stroke(Color.white.opacity(strokeOpacity), lineWidth: strokeWidth)
            }
        }
    }
}

extension View {
    /// Wraps the view in a glass background that adapts to Increase Contrast.
    /// When High Contrast is active, the material becomes thicker and borders
    /// become more visible.
    ///
    /// - Parameters:
    ///   - cornerRadius: optional rounding for the background.
    ///   - addsBorder: adds a subtle hairline in default mode and a visible
    ///     stroke in high-contrast mode.
    func contrastAdaptive(
        cornerRadius: CGFloat? = nil,
        addsBorder: Bool = false
    ) -> some View {
        modifier(ContrastAdaptive(cornerRadius: cornerRadius, addsBorder: addsBorder))
    }
}
