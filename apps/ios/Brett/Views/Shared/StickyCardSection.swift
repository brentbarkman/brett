import SwiftUI

/// A card section with Apple Weather–style sticky headers.
///
/// Each section manages its own material in two independent zones:
///   - Header: topShape-clipped .thinMaterial (always rounded top corners)
///   - Body: rectangle .thinMaterial masked to clip at the header boundary
///
/// No card-level material means nothing leaks through the header's
/// rounded corners. The body mask ensures content AND its material
/// both vanish at the header's bottom edge during scroll.
struct StickyCardSection<Header: View, Content: View>: View {
    var tint: Color? = nil
    @ViewBuilder var header: () -> Header
    @ViewBuilder var content: () -> Content

    private let cornerRadius: CGFloat = 14
    private let headerHeight: CGFloat = 38

    var body: some View {
        let cardShape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        let topShape = UnevenRoundedRectangle(
            topLeadingRadius: cornerRadius, bottomLeadingRadius: 0,
            bottomTrailingRadius: 0, topTrailingRadius: cornerRadius,
            style: .continuous
        )

        VStack(spacing: 0) {
            // Reserve space for the header + separator
            Color.clear.frame(height: headerHeight + 0.5)

            // Body: content + its own material, both masked at the header boundary.
            // The mask clips content AND material together so nothing bleeds
            // through the header's rounded corners.
            content()
                .background {
                    Rectangle().fill(.thinMaterial)
                }
                .background {
                    if let tint {
                        Rectangle().fill(tint.opacity(0.10))
                    }
                }
                .mask {
                    GeometryReader { bodyGeo in
                        let bodyMinY = bodyGeo.frame(in: .named("scroll")).minY
                        let cardMinY = bodyMinY - (headerHeight + 0.5)
                        let scrolledPast = max(0, -cardMinY)

                        VStack(spacing: 0) {
                            // Hidden: body that has scrolled behind the header
                            Color.clear.frame(height: scrolledPast)
                            // Visible: everything below the header
                            Color.black
                        }
                    }
                }
        }
        // Sticky header overlay with its own material
        .overlay(alignment: .top) {
            GeometryReader { geo in
                let frame = geo.frame(in: .named("scroll"))
                let scrolledPast = max(0, -frame.minY)
                let maxOffset = max(0, geo.size.height - headerHeight)
                let offset = min(scrolledPast, maxOffset)

                let fadeDistance: CGFloat = 24
                let distanceToMax = maxOffset - offset
                let opacity = distanceToMax < fadeDistance
                    ? distanceToMax / fadeDistance
                    : 1.0

                VStack(spacing: 0) {
                    header()
                        .frame(maxWidth: .infinity)
                        .frame(height: headerHeight)
                        .padding(.horizontal, 16)

                    Rectangle()
                        .fill(Color.white.opacity(0.08))
                        .frame(height: 0.5)
                }
                .background {
                    topShape.fill(.thinMaterial)
                }
                .background {
                    // Extra fill so the header visually matches the body's
                    // perceived opacity (body content adds its own layers).
                    topShape.fill(Color.white.opacity(0.05))
                }
                .background {
                    if let tint {
                        topShape.fill(tint.opacity(0.10))
                    }
                }
                .clipShape(topShape)
                .offset(y: offset)
                .opacity(opacity)
            }
        }
        // Clip outer card shape (rounds bottom corners of body)
        .clipShape(cardShape)
        .overlay { cardShape.strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5) }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }
}
