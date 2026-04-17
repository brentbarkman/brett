import SwiftUI

/// The stacked three-row gold brief — Brett's product mark. Matches
/// `docs/logo.png` and the desktop icon (`apps/desktop/resources/icon.svg`).
///
/// Drawn with `Canvas` so it scales crisply at any size and stays in sync
/// with the brand without shipping raster assets. Rows cascade-fade at
/// 100% / 75% / 45% per the brand guide.
///
/// Use at any size via `.frame(width:height:)`. Defaults to square aspect.
struct BrandMark: View {
    /// Optional uniform opacity applied to all three rows. Callers animating
    /// a breathing effect (launch splash) can bind to this. Defaults to 1.0
    /// (no dimming) so the mark reads at full strength on most surfaces.
    var masterOpacity: Double = 1.0

    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 96.0 // uniform scale — 96-unit coordinate space
            let dotR: CGFloat = 8 * s
            let barH: CGFloat = 6 * s
            let barStartX: CGFloat = 22 * s
            let dotCenterX: CGFloat = 14 * s

            // Gold gradient — matches the #F5D96B → #E8B931 → #B8891A
            // metallic sweep from icon.svg.
            let gold = Gradient(colors: [
                Color(red: 245/255, green: 217/255, blue: 107/255),
                Color(red: 232/255, green: 185/255, blue: 49/255),
                Color(red: 184/255, green: 137/255, blue: 26/255),
            ])

            let rows: [(dotY: CGFloat, barW: CGFloat, opacity: Double)] = [
                (dotY: 20, barW: 58, opacity: 1.00),
                (dotY: 48, barW: 45, opacity: 0.75),
                (dotY: 76, barW: 30, opacity: 0.45),
            ]

            for row in rows {
                let dotY = row.dotY * s
                let barW = row.barW * s

                var layer = ctx
                layer.opacity = row.opacity * masterOpacity

                // Dot (sphere) — top-to-bottom gold gradient.
                let dotRect = CGRect(
                    x: dotCenterX - dotR,
                    y: dotY - dotR,
                    width: dotR * 2,
                    height: dotR * 2
                )
                layer.fill(
                    Path(ellipseIn: dotRect),
                    with: .linearGradient(
                        gold,
                        startPoint: CGPoint(x: dotRect.midX, y: dotRect.minY),
                        endPoint: CGPoint(x: dotRect.midX, y: dotRect.maxY)
                    )
                )

                // Bar (pill) — same gradient, rounded to height/2.
                let barRect = CGRect(
                    x: barStartX,
                    y: dotY - barH / 2,
                    width: barW,
                    height: barH
                )
                layer.fill(
                    Path(roundedRect: barRect, cornerRadius: barH / 2),
                    with: .linearGradient(
                        gold,
                        startPoint: CGPoint(x: barRect.midX, y: barRect.minY),
                        endPoint: CGPoint(x: barRect.midX, y: barRect.maxY)
                    )
                )
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)  // decorative; callers provide wordmark text
    }
}

#Preview {
    ZStack {
        Color(red: 10/255, green: 10/255, blue: 10/255)
        BrandMark()
            .frame(width: 120, height: 120)
    }
    .frame(width: 300, height: 300)
}
