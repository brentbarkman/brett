import Foundation
import Testing
@testable import Brett

/// Covers the pure scroll math for `StickyCardSection`. The view itself
/// can't run headless, but the offset, opacity, and body-mask heights
/// that drive the sticky-header + rounded-top-corner behaviour are
/// extracted into `StickyHeaderLayout` and tested directly here.
///
/// Regressions these tests guard:
///  - Headers instantly fading to invisible on first pixel of scroll
///    (previous bug: `maxOffset ≈ 0`).
///  - Body material leaking into the header band, producing the
///    "header brighter than body" double-material seam.
///  - Header overshooting the card's bottom edge instead of riding off
///    with it.
@Suite("StickyHeaderLayout", .tags(.views))
struct StickyHeaderLayoutTests {
    // Representative card of ~9 rows: header 38, separator 0.5, body 400.
    private let cardHeight: CGFloat = 438.5
    private let headerHeight: CGFloat = 38
    private let fadeDistance: CGFloat = 24

    // MARK: - headerOffset

    @Test("At rest, header offset is zero")
    func offsetAtRest() {
        let offset = StickyHeaderLayout.headerOffset(
            scrolledPast: 0, cardHeight: cardHeight, headerHeight: headerHeight
        )
        #expect(offset == 0)
    }

    @Test("While pinning, header offset tracks scroll 1:1")
    func offsetTracksScroll() {
        let offset = StickyHeaderLayout.headerOffset(
            scrolledPast: 120, cardHeight: cardHeight, headerHeight: headerHeight
        )
        #expect(offset == 120)
    }

    @Test("Header offset saturates at cardHeight - headerHeight")
    func offsetSaturates() {
        let max = cardHeight - headerHeight // 400.5
        let justBelow = StickyHeaderLayout.headerOffset(
            scrolledPast: max - 1, cardHeight: cardHeight, headerHeight: headerHeight
        )
        let atMax = StickyHeaderLayout.headerOffset(
            scrolledPast: max, cardHeight: cardHeight, headerHeight: headerHeight
        )
        let beyond = StickyHeaderLayout.headerOffset(
            scrolledPast: max + 5_000, cardHeight: cardHeight, headerHeight: headerHeight
        )
        #expect(justBelow == max - 1)
        #expect(atMax == max)
        #expect(beyond == max, "header must not overshoot the card's bottom edge")
    }

    @Test("Negative scrolledPast is clamped to zero (rubber-band pull-down)")
    func offsetClampsNegative() {
        let offset = StickyHeaderLayout.headerOffset(
            scrolledPast: -80, cardHeight: cardHeight, headerHeight: headerHeight
        )
        #expect(offset == 0)
    }

    @Test("Degenerate card shorter than header still yields non-negative offset")
    func offsetHandlesDegenerateCard() {
        let offset = StickyHeaderLayout.headerOffset(
            scrolledPast: 50, cardHeight: 20, headerHeight: 38
        )
        #expect(offset == 0, "cardHeight < headerHeight forces maxOffset=0")
    }

    // MARK: - headerOpacity

    @Test("Header is fully opaque at rest — no instant-fade regression")
    func opacityFullAtRest() {
        let opacity = StickyHeaderLayout.headerOpacity(
            scrolledPast: 0,
            cardHeight: cardHeight,
            headerHeight: headerHeight,
            fadeDistance: fadeDistance
        )
        #expect(opacity == 1)
    }

    @Test("Header stays fully opaque through the pinning travel, until the fade zone")
    func opacityStaysFullDuringPinning() {
        let maxOffset = cardHeight - headerHeight // 400.5
        let opacity = StickyHeaderLayout.headerOpacity(
            scrolledPast: maxOffset - fadeDistance - 1, // just above fade zone
            cardHeight: cardHeight,
            headerHeight: headerHeight,
            fadeDistance: fadeDistance
        )
        #expect(opacity == 1)
    }

    @Test("Header opacity ramps linearly through the fade zone")
    func opacityRampsInFadeZone() {
        let maxOffset = cardHeight - headerHeight
        // Halfway through the fade distance → ~0.5
        let halfway = StickyHeaderLayout.headerOpacity(
            scrolledPast: maxOffset - fadeDistance / 2,
            cardHeight: cardHeight,
            headerHeight: headerHeight,
            fadeDistance: fadeDistance
        )
        #expect(abs(halfway - 0.5) < 0.001)
    }

    @Test("Header opacity is zero once saturated")
    func opacityZeroAtSaturation() {
        let maxOffset = cardHeight - headerHeight
        let atMax = StickyHeaderLayout.headerOpacity(
            scrolledPast: maxOffset,
            cardHeight: cardHeight,
            headerHeight: headerHeight,
            fadeDistance: fadeDistance
        )
        let beyond = StickyHeaderLayout.headerOpacity(
            scrolledPast: maxOffset + 1_000,
            cardHeight: cardHeight,
            headerHeight: headerHeight,
            fadeDistance: fadeDistance
        )
        #expect(atMax == 0)
        #expect(beyond == 0)
    }

    // MARK: - bodyMaskedHeight
    //
    // This is the seam-prevention invariant. For any scroll position,
    // the masked-out region at the top of the body must cover through
    // the bottom of the header's material band (header + separator).
    // If this ever drifts lower, the body's material starts stacking
    // with the header's material → visible "brighter seam".

    @Test("At rest, masked height covers header plus separator")
    func maskAtRestCoversHeader() {
        let masked = StickyHeaderLayout.bodyMaskedHeight(
            scrolledPast: 0, cardHeight: cardHeight, headerHeight: headerHeight
        )
        #expect(masked == headerHeight + StickyHeaderLayout.separatorHeight)
    }

    @Test("Masked height tracks the header's bottom edge during pinning")
    func maskTracksHeaderBottom() {
        let masked = StickyHeaderLayout.bodyMaskedHeight(
            scrolledPast: 150, cardHeight: cardHeight, headerHeight: headerHeight
        )
        #expect(masked == 150 + headerHeight + StickyHeaderLayout.separatorHeight)
    }

    @Test("Masked height never sits above the header's material band")
    func maskCoversHeaderAtEveryDepth() {
        // At every sampled scroll depth the body mask MUST be ≥ the
        // offset + headerHeight. If it were less, body material would
        // render inside the header band and stack with it → visible
        // seam. The +separatorHeight is a guarantee, not a margin.
        for scroll in stride(from: CGFloat(0), through: cardHeight + 200, by: 17) {
            let offset = StickyHeaderLayout.headerOffset(
                scrolledPast: scroll,
                cardHeight: cardHeight,
                headerHeight: headerHeight
            )
            let masked = StickyHeaderLayout.bodyMaskedHeight(
                scrolledPast: scroll,
                cardHeight: cardHeight,
                headerHeight: headerHeight
            )
            #expect(
                masked >= offset + headerHeight,
                "mask at scrolledPast=\(scroll) must cover the header band"
            )
        }
    }

    @Test("Masked height saturates when the header saturates")
    func maskSaturatesWithHeader() {
        let maxOffset = cardHeight - headerHeight
        let atMax = StickyHeaderLayout.bodyMaskedHeight(
            scrolledPast: maxOffset,
            cardHeight: cardHeight,
            headerHeight: headerHeight
        )
        let beyond = StickyHeaderLayout.bodyMaskedHeight(
            scrolledPast: maxOffset + 500,
            cardHeight: cardHeight,
            headerHeight: headerHeight
        )
        #expect(atMax == beyond, "mask must stop growing once the header saturates")
    }
}
