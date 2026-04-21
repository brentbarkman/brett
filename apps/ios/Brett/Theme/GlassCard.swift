import SwiftUI

/// Tint-aware border helper. Used by both `GlassCard` and
/// `.glassCard(tint:)` so they share the same brand treatment: when a
/// tint is provided, the card carries a signature 1pt rim of that tint
/// at /30 opacity — mirrors Electron's
/// `border border-brett-cerulean/30` on AI surfaces (Brett's Take,
/// Daily Briefing, Brett Chat). Default neutral border is white/0.10.
private func glassCardBorder(tint: Color?) -> some View {
    RoundedRectangle(cornerRadius: 14, style: .continuous)
        .strokeBorder(
            tint.map { $0.opacity(0.30) } ?? Color.white.opacity(0.10),
            lineWidth: 1
        )
}

struct GlassCard<Content: View>: View {
    var tint: Color? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(16)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.thinMaterial)
                    .overlay {
                        if let tint {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(tint.opacity(0.10))
                        }
                    }
                    .overlay { glassCardBorder(tint: tint) }
            }
    }
}

// Convenience modifier for views that want glass styling
extension View {
    func glassCard(tint: Color? = nil) -> some View {
        self
            .padding(16)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.thinMaterial)
                    .overlay {
                        if let tint {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(tint.opacity(0.10))
                        }
                    }
                    .overlay { glassCardBorder(tint: tint) }
            }
    }
}
