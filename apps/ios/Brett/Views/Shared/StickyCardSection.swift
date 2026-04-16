import SwiftUI

/// A card section with Apple Weather–style sticky headers.
///
/// **Single-material composition.** ONE `.thinMaterial` layer on the
/// outer card shape spans the whole card. The sticky header overlay is
/// just content + a separator drawn on top — no second material layer
/// of its own. This eliminates the "header looks brighter than the
/// body" perception issue that the user flagged: stacking two
/// independent `.thinMaterial` layers, even with identical opacity,
/// produced a visible seam because each layer ran its own backdrop
/// sample. One material = one sample = one uniform card.
///
/// The body content carries a `.mask` that hides rows scrolling up
/// behind the sticky header position, so we don't need extra material
/// on the header to occlude scrolling content — rows are clipped
/// before they ever reach that area.
struct StickyCardSection<Header: View, Content: View>: View {
    var tint: Color? = nil
    @ViewBuilder var header: () -> Header
    @ViewBuilder var content: () -> Content

    private let cornerRadius: CGFloat = 14
    private let headerHeight: CGFloat = 38

    var body: some View {
        let cardShape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        ZStack(alignment: .top) {
            // Single material layer for the whole card. Header + body
            // sit on top of this — no per-zone material means the two
            // zones can't visually diverge.
            cardShape.fill(.thinMaterial)
            if let tint {
                cardShape.fill(tint.opacity(0.10))
            }

            // Body content. Leading Color.clear reserves the header's
            // footprint so the first row sits below the sticky band.
            // The mask hides rows that have scrolled past the header
            // line during pinning so they never appear behind the
            // sticky header overlay.
            VStack(spacing: 0) {
                Color.clear.frame(height: headerHeight + 0.5)
                content()
                    .mask {
                        GeometryReader { bodyGeo in
                            let bodyMinY = bodyGeo.frame(in: .named("scroll")).minY
                            let cardMinY = bodyMinY - (headerHeight + 0.5)
                            let scrolledPast = max(0, -cardMinY)

                            VStack(spacing: 0) {
                                Color.clear.frame(height: scrolledPast)
                                Color.black
                            }
                        }
                    }
            }

            // Sticky header — content only (no own material). The
            // card's single material below shows through; the body's
            // mask keeps scrolled-up rows from peeking through.
            //
            // The GeometryReader is NOT constrained to headerHeight — it
            // fills the full card ZStack so `geo.size.height` reflects the
            // TOTAL card height. That gives `maxOffset` the right value:
            // the header can travel from its natural top-of-card position
            // all the way down to the card's bottom edge before fading.
            // Previous version used `.frame(height: headerHeight + 0.5)`
            // which made `maxOffset ≈ 0`, causing headers to instantly
            // fade to invisible on the first pixel of scroll.
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
                .offset(y: offset)
                .opacity(opacity)
            }
        }
        .clipShape(cardShape)
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
