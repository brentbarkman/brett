import SwiftUI

/// Pure layout math for `StickyCardSection`. Extracted so the scroll
/// behaviour is unit-testable without having to render SwiftUI —
/// `StickyHeaderLayoutTests` exercises these directly.
///
/// The card has a sticky header that pins at viewport top while the
/// card scrolls past it. `headerOffset` is how far the header has
/// translated down (in card-local coords) to compensate for the card's
/// scroll, saturating at the card's bottom so the header eventually
/// rides off with the rest of the card.
enum StickyHeaderLayout {
    /// Thickness of the hairline separator under the header content.
    /// Lives in the header's own material band so the body mask must
    /// account for it.
    static let separatorHeight: CGFloat = 0.5

    /// How far the sticky header is offset from its resting position
    /// at the top of the card. Clamps to 0 on the low end (no upward
    /// travel) and `cardHeight - headerHeight` on the high end so the
    /// header can't extend past the card's bottom edge.
    static func headerOffset(
        scrolledPast: CGFloat,
        cardHeight: CGFloat,
        headerHeight: CGFloat
    ) -> CGFloat {
        let maxOffset = max(0, cardHeight - headerHeight)
        return min(max(0, scrolledPast), maxOffset)
    }

    /// Fade applied as the header approaches the card's bottom edge so
    /// it doesn't abruptly pop off when the card rides away. 1 while
    /// the header has at least `fadeDistance` of travel left, 0 once
    /// it's at (or past) saturation.
    static func headerOpacity(
        scrolledPast: CGFloat,
        cardHeight: CGFloat,
        headerHeight: CGFloat,
        fadeDistance: CGFloat
    ) -> CGFloat {
        let maxOffset = max(0, cardHeight - headerHeight)
        let offset = headerOffset(
            scrolledPast: scrolledPast,
            cardHeight: cardHeight,
            headerHeight: headerHeight
        )
        let distanceToMax = maxOffset - offset
        guard fadeDistance > 0 else { return distanceToMax > 0 ? 1 : 0 }
        if distanceToMax >= fadeDistance { return 1 }
        return max(0, distanceToMax / fadeDistance)
    }

    /// Height (in body-local / card-local coords) of the region at the
    /// top of the body that must be masked out. This is the header's
    /// current bottom edge — everything above this y is either above
    /// the viewport or visually occupied by the sticky header band, so
    /// the body's material must not render there. If it did, the body
    /// material would stack with the header material, producing the
    /// visible "header looks brighter than body" seam.
    static func bodyMaskedHeight(
        scrolledPast: CGFloat,
        cardHeight: CGFloat,
        headerHeight: CGFloat
    ) -> CGFloat {
        let offset = headerOffset(
            scrolledPast: scrolledPast,
            cardHeight: cardHeight,
            headerHeight: headerHeight
        )
        return offset + headerHeight + separatorHeight
    }
}

/// A card section with Apple Weather–style sticky headers.
///
/// **Two-zone material composition.** The header owns its own
/// `.thinMaterial` clipped to a top-rounded `UnevenRoundedRectangle`;
/// the body owns its own `.thinMaterial` as a background, masked
/// together with the content so the body's material never renders
/// behind the header. This keeps the visible viewport-top boundary
/// rounded — even after the card's actual rounded top has scrolled
/// out of view — while avoiding the double-material seam that a naive
/// two-material stack produces (each layer runs its own backdrop
/// sample, so two stacked `.thinMaterial`s at the same opacity still
/// read as brighter).
///
/// The earlier "one material on the outer card shape" approach kept
/// the header and body visually uniform at rest but produced square
/// corners the instant the card began to scroll: the card's rounded
/// corners live at y=0..cornerRadius of its shape, so once the card
/// has scrolled past that, the visible top edge of the card shape is
/// a straight line.
struct StickyCardSection<Header: View, Content: View>: View {
    var tint: Color? = nil
    @ViewBuilder var header: () -> Header
    @ViewBuilder var content: () -> Content

    private let cornerRadius: CGFloat = 14
    private let headerHeight: CGFloat = 38
    private let fadeDistance: CGFloat = 24

    var body: some View {
        let cardShape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        let headerShape = UnevenRoundedRectangle(
            topLeadingRadius: cornerRadius,
            bottomLeadingRadius: 0,
            bottomTrailingRadius: 0,
            topTrailingRadius: cornerRadius,
            style: .continuous
        )

        ZStack(alignment: .top) {
            // Body zone. Material + content are masked together at the
            // header's current bottom edge so they never render
            // underneath the header band (no double-material seam).
            // Clipped to the full card shape so the bottom corners
            // round; the top corners are inside the masked region and
            // never visible.
            VStack(spacing: 0) {
                // Reserve the header footprint at rest so the first
                // row sits below the header band instead of underneath
                // it.
                Color.clear.frame(height: headerHeight + StickyHeaderLayout.separatorHeight)
                content()
            }
            .background(.thinMaterial)
            .background(tint.map { $0.opacity(0.10) } ?? Color.clear)
            .mask {
                GeometryReader { bodyGeo in
                    let bodyMinY = bodyGeo.frame(in: .named("scroll")).minY
                    let scrolledPast = max(0, -bodyMinY)
                    let masked = StickyHeaderLayout.bodyMaskedHeight(
                        scrolledPast: scrolledPast,
                        cardHeight: bodyGeo.size.height,
                        headerHeight: headerHeight
                    )

                    VStack(spacing: 0) {
                        Color.clear.frame(height: masked)
                        Color.black
                    }
                }
            }
            .clipShape(cardShape)

            // Sticky header zone. Owns its own material clipped to a
            // top-rounded shape so the viewport-top boundary stays
            // rounded regardless of scroll position. The body mask
            // above ensures there's no body material underneath this
            // band, so the two zones meet cleanly without stacking.
            GeometryReader { geo in
                let frame = geo.frame(in: .named("scroll"))
                let scrolledPast = max(0, -frame.minY)
                let offset = StickyHeaderLayout.headerOffset(
                    scrolledPast: scrolledPast,
                    cardHeight: geo.size.height,
                    headerHeight: headerHeight
                )
                let opacity = StickyHeaderLayout.headerOpacity(
                    scrolledPast: scrolledPast,
                    cardHeight: geo.size.height,
                    headerHeight: headerHeight,
                    fadeDistance: fadeDistance
                )

                VStack(spacing: 0) {
                    header()
                        .frame(maxWidth: .infinity)
                        .frame(height: headerHeight)
                        .padding(.horizontal, 16)

                    Rectangle()
                        .fill(Color.white.opacity(0.08))
                        .frame(height: StickyHeaderLayout.separatorHeight)
                }
                .background(.thinMaterial)
                .background(tint.map { $0.opacity(0.10) } ?? Color.clear)
                .clipShape(headerShape)
                .offset(y: offset)
                .opacity(opacity)
            }
        }
        // Border picks up the tint when one is provided so AI-surface
        // cards (Brett's Take, Daily Briefing, Brett Chat) carry the
        // signature cerulean rim — matches Electron's
        // `border border-brett-cerulean/30` treatment.
        .overlay {
            cardShape.strokeBorder(
                tint.map { $0.opacity(0.30) } ?? Color.white.opacity(0.10),
                lineWidth: tint == nil ? 0.5 : 1
            )
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }
}
