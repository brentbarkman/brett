import SwiftUI

/// Tint-aware border helper. Used by both `GlassCard` and
/// `.glassCard(tint:)` so they share the same brand treatment: when a
/// tint is provided, the card carries a signature 1pt rim of that tint
/// at /30 opacity — mirrors Electron's
/// `border border-brett-cerulean/30` on AI surfaces (Brett's Take,
/// Daily Briefing, Brett Chat). Default neutral border is white/0.12
/// to match the canonical card glass (see apps/ios/DESIGN.md).
private func glassCardBorder(tint: Color?) -> some View {
    RoundedRectangle(cornerRadius: 14, style: .continuous)
        .strokeBorder(
            tint.map { $0.opacity(0.30) } ?? Color.white.opacity(0.12),
            lineWidth: 1
        )
}

/// Canonical card chrome shared across the iOS app. Single white
/// fill at /0.07 (NOT a SwiftUI material) + the canonical hairline
/// border. Mirrors the v18 mockup `.card { background:
/// rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12) }`.
///
/// The earlier `.thinMaterial` fill was layered on top of a wash that's
/// already tinted, so the resulting card read brighter than spec — and
/// brighter than `StickyCardSection` which uses the spec value. Going
/// material-free here unifies every card surface in the app: Today task
/// sections, Inbox card, Lists rows, Calendar timeline, Settings cards,
/// Scouts cards, NextUpCard.
struct GlassCard<Content: View>: View {
    var tint: Color? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(16)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.white.opacity(0.07))
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
                    .fill(Color.white.opacity(0.07))
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
