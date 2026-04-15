import SwiftUI

/// Full-screen splash shown after the system launch storyboard, while auth
/// and initial data are loading. Pure black canvas, centered stacked gold mark
/// with a slow pulsing glow, tiny "Brett" wordmark underneath.
///
/// No activity indicator — instead the mark breathes at 2s cadence so the
/// app feels alive without feeling like a loading state.
struct LaunchView: View {
    @State private var pulse: Double = 0.5

    var body: some View {
        ZStack {
            // Canvas — matches the app's dark base
            Color(red: 10/255, green: 10/255, blue: 10/255)
                .ignoresSafeArea()

            // Faint gold radial warmth behind the mark
            RadialGradient(
                colors: [
                    BrettColors.gold.opacity(0.10),
                    BrettColors.gold.opacity(0.0),
                ],
                center: .center,
                startRadius: 0,
                endRadius: 260
            )
            .ignoresSafeArea()

            VStack(spacing: 28) {
                // Stacked brand mark with pulsing gold glow
                ZStack {
                    // Glow behind the mark
                    Circle()
                        .fill(BrettColors.gold.opacity(0.22))
                        .frame(width: 180, height: 180)
                        .blur(radius: 48)
                        .opacity(pulse)

                    BrandMark()
                        .frame(width: 104, height: 104)
                        .opacity(0.6 + pulse * 0.4)
                }

                // Tiny wordmark
                Text("Brett")
                    .font(.system(size: 13, weight: .medium))
                    .tracking(3.5)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.white.opacity(0.40))
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 2.0).repeatForever(autoreverses: true)) {
                pulse = 1.0
            }
        }
    }
}

/// The stacked three-bar gold mark — matches docs/logo.png and desktop icon.
/// Drawn with Canvas so it scales crisply and stays in sync with the brand.
private struct BrandMark: View {
    // Canvas dimensions mirror the SVG viewBox (0..96 for the mark area,
    // pulled from the 512-unit original: dots r=28 -> 5.25, bars h=22 -> 4.1).
    // We use a 96x96 coordinate space for simplicity.
    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 96.0 // uniform scale
            let dotR: CGFloat = 8 * s
            let barH: CGFloat = 6 * s
            let barStartX: CGFloat = 22 * s
            let dotCenterX: CGFloat = 14 * s

            let gold = Gradient(colors: [
                Color(red: 245/255, green: 217/255, blue: 107/255), // #F5D96B
                Color(red: 232/255, green: 185/255, blue: 49/255),  // #E8B931
                Color(red: 184/255, green: 137/255, blue: 26/255),  // #B8891A
            ])

            let rows: [(dotY: CGFloat, barW: CGFloat, opacity: Double)] = [
                (dotY: 20, barW: 58, opacity: 1.0),
                (dotY: 48, barW: 45, opacity: 0.75),
                (dotY: 76, barW: 30, opacity: 0.45),
            ]

            for row in rows {
                let dotY = row.dotY * s
                let barW = row.barW * s

                var layer = ctx
                layer.opacity = row.opacity

                // Sphere
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

                // Bar (rounded)
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
    }
}

#Preview {
    LaunchView()
}
