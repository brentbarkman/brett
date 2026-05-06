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

    private let cornerRadius: CGFloat = 16  // v18 mockup `.card { border-radius: 16px }`
    private let headerHeight: CGFloat = 38
    private let fadeDistance: CGFloat = 24

    var body: some View {
        let cardShape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        ZStack(alignment: .top) {
            // Body card — the only glass plate per the v18 mockup
            // (`.card { background: rgba(255,255,255,0.07); blur(20px)
            // saturate(140%); border: 1px rgba(255,255,255,0.12) }`).
            // Header is rendered separately above (no card chrome on
            // the header) so the visual matches the mockup's
            // "section-head as plain text floating above the card."
            VStack(spacing: 0) {
                // Reserve the header footprint at rest so the first
                // row sits below the header band instead of
                // underneath it.
                Color.clear.frame(height: headerHeight + StickyHeaderLayout.separatorHeight)
                content()
            }
            .background {
                // Mockup `.card` glass: white-tint base + ultraThin
                // material blur underneath. SwiftUI's .ultraThinMaterial
                // is the closest stock equivalent of `blur(20px)
                // saturate(140%)`; the white tint on top brings it
                // to the white/0.07 base.
                cardShape
                    .fill(Color.white.opacity(0.07))
                    .background(cardShape.fill(.ultraThinMaterial))
            }
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
            .overlay {
                // Border on the body card only — the header sits on
                // the wash (no card chrome) so it doesn't carry the
                // border. AI-surface cards (Brett's Take, Daily
                // Briefing) get a cerulean rim via `tint`.
                cardShape.strokeBorder(
                    tint.map { $0.opacity(0.30) } ?? Color.white.opacity(0.12),
                    lineWidth: 1
                )
            }
            .clipShape(cardShape)

            // Sticky header zone. NO card chrome here — just the
            // header content (label + count pill) on a wash-colored
            // band. When the header pins to the viewport top and
            // items scroll under it, the wash bg occludes them
            // (looks like items "disappear into the wash"). When
            // the section is exhausted, the band fades out and the
            // next section's header takes its place.
            //
            // The wash band reads as a continuation of the page
            // background rather than a card-chrome strip, which is
            // what the mockup shows (`.section-head` as a sibling
            // of `.card`, not nested inside it).
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

                header()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(height: headerHeight)
                    .padding(.horizontal, 4)
                    .background(BackgroundService.shared.currentWashColor)
                    .offset(y: offset)
                    .opacity(opacity)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }
}
