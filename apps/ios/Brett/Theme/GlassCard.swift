import SwiftUI

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
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
                    }
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
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
                    }
            }
    }
}
