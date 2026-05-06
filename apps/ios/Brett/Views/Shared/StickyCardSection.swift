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
    /// Header band height. Bumped from 26 → 32 to fit the larger
    /// 13pt-semibold label (was 11pt) and a bigger count pill —
    /// the mockup-spec sizes were too small to read comfortably on
    /// a real iPhone, so we pulled both up a step. Still sits as a
    /// quiet label floating above the card rather than a heavy
    /// headerbar.
    private let headerHeight: CGFloat = 32
    private let fadeDistance: CGFloat = 24

    var body: some View {
        let cardShape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        // Layout per v18 mockup: section-head sits as a SIBLING
        // above the card (cards-area > section-head + card). To get
        // that visual while keeping the iOS app's sticky-pin
        // behavior, we stack header + card vertically (so the card
        // is plainly below the header at rest) and overlay the
        // header on its own reserved area at the top. As the user
        // scrolls, the header pins to the viewport top and the
        // card scrolls under it; the body mask clips items at the
        // header's bottom edge so the rows look like they
        // "disappear into the page" as they pass.
        ZStack(alignment: .top) {
            VStack(spacing: 6) {
                // Reserved header zone (transparent — the floating
                // header sits in this space at rest). 6pt gap to
                // the card matches the mockup's `cards-area gap:
                // 10px` minus the section-head's bottom padding 6
                // ≈ 4–6pt space between header text and card top.
                Color.clear.frame(height: headerHeight)

                // The actual card — glass body with rows. Card
                // chrome (glass + border) is bounded to this area
                // only, NOT extending up behind the header text.
                content()
                    .background {
                        cardShape.fill(Color.white.opacity(0.07))
                    }
                    .background(tint.map { $0.opacity(0.10) } ?? Color.clear)
                    // Border composed BEFORE the mask. Earlier order
                    // (mask → overlay) left the side borders showing
                    // through above the pinned header, because the
                    // mask had already clipped the body but the
                    // overlay-stroke ran on the unmasked card shape
                    // afterward. Putting `.overlay` first means the
                    // border is part of the same group the mask
                    // clips — so when the body's top is masked, the
                    // border at that y-range is masked along with it.
                    .overlay {
                        cardShape.strokeBorder(
                            tint.map { $0.opacity(0.30) } ?? Color.white.opacity(0.12),
                            lineWidth: 1
                        )
                    }
                    .mask {
                        GeometryReader { bodyGeo in
                            let bodyMinY = bodyGeo.frame(in: .named("scroll")).minY
                            // Mask covers the area where the pinned
                            // header sits above the body. With the
                            // new outer-VStack layout, the body's
                            // top in scroll coords is positive at
                            // rest (sits below the header reservation),
                            // so no clipping is needed until the body
                            // scrolls up far enough that its first
                            // rows pass under the header's pinned
                            // bottom edge. Formula:
                            //   masked = max(0, headerHeight - bodyMinY)
                            // — at rest bodyMinY > headerHeight so
                            // masked == 0; at full pin masked grows
                            // to hide everything above the header
                            // edge.
                            let masked = max(0, headerHeight - bodyMinY)

                            VStack(spacing: 0) {
                                Color.clear.frame(height: masked)
                                Color.black
                            }
                        }
                    }
                    .clipShape(cardShape)
            }

            // Sticky header zone. NO card chrome — just the header
            // text + count pill floating above the card. Pinned to
            // the viewport top once the section enters scroll
            // range; fades out as the next section approaches.
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
                    .offset(y: offset)
                    .opacity(opacity)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }
}
