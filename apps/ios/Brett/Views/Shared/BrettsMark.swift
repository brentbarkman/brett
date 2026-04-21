import SwiftUI

/// Brett's Mark — the AI avatar. Three gold dots + three cerulean lines
/// cascading in length and opacity, the "brief" metaphor. Mirrors the
/// desktop `BrettMark` component in `packages/ui/src/BrettMark.tsx`; any
/// visual change must land on both platforms per the iOS ↔ desktop parity
/// rule in CLAUDE.md.
///
/// When `thinking` is true, the cerulean lines draw in, hold, then retract
/// in staggered succession — a summary being composed in real time.
struct BrettsMark: View {
    var size: CGFloat = 16
    var thinking: Bool = false

    // 24×24 coordinate space, matches the desktop SVG viewBox.
    private static let rows: [(y: CGFloat, end: CGFloat, baseOpacity: Double)] = [
        (y: 5,  end: 21, baseOpacity: 1.0),
        (y: 12, end: 18, baseOpacity: 0.7),
        (y: 19, end: 14, baseOpacity: 0.45),
    ]

    // Gold radial gradient for the dots. Bright stops for small-size
    // legibility on glass — matches desktop's in-app BrettMark palette
    // (brighter than the deep-amber app-icon gradient on iOS BrandMark).
    private static let gold = Gradient(stops: [
        .init(color: Color(red: 252/255, green: 232/255, blue: 120/255), location: 0.00), // #FCE878
        .init(color: Color(red: 232/255, green: 185/255, blue: 49/255),  location: 0.55), // #E8B931
        .init(color: Color(red: 212/255, green: 160/255, blue: 32/255),  location: 1.00), // #D4A020
    ])

    var body: some View {
        Group {
            if thinking {
                TimelineView(.animation) { context in
                    Canvas { ctx, canvasSize in
                        render(ctx: ctx, size: canvasSize, now: context.date.timeIntervalSinceReferenceDate)
                    }
                }
            } else {
                Canvas { ctx, canvasSize in
                    render(ctx: ctx, size: canvasSize, now: nil)
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel("Brett")
    }

    private func render(ctx: GraphicsContext, size: CGSize, now: TimeInterval?) {
        let s = size.width / 24.0
        let dotCX: CGFloat = 4 * s
        let dotR: CGFloat = 2.4 * s
        let lineStartX: CGFloat = 8 * s
        let strokeW: CGFloat = 2.2 * s

        for (i, row) in Self.rows.enumerated() {
            let y = row.y * s
            let endX = row.end * s
            let lineLen = endX - lineStartX

            // Dot — radial gold gradient with top-left highlight at 35%/32%,
            // reach 60% of the dot bounding box. Matches the SVG radialGradient.
            let dotRect = CGRect(
                x: dotCX - dotR,
                y: y - dotR,
                width: dotR * 2,
                height: dotR * 2
            )
            var dotCtx = ctx
            dotCtx.opacity = row.baseOpacity
            dotCtx.fill(
                Path(ellipseIn: dotRect),
                with: .radialGradient(
                    Self.gold,
                    center: CGPoint(
                        x: dotRect.minX + dotRect.width * 0.35,
                        y: dotRect.minY + dotRect.height * 0.32
                    ),
                    startRadius: 0,
                    endRadius: dotR * 1.2
                )
            )

            // Cerulean line — static when !thinking, animated brief-draw otherwise.
            let (visibleStart, visibleEnd, opacity) = lineState(
                row: i,
                baseOpacity: row.baseOpacity,
                lineLen: lineLen,
                now: now
            )

            if visibleEnd > visibleStart {
                var linePath = Path()
                linePath.move(to: CGPoint(x: lineStartX + visibleStart, y: y))
                linePath.addLine(to: CGPoint(x: lineStartX + visibleEnd, y: y))

                var lineCtx = ctx
                lineCtx.opacity = opacity
                lineCtx.stroke(
                    linePath,
                    with: .color(BrettColors.cerulean),
                    style: StrokeStyle(lineWidth: strokeW, lineCap: .round)
                )
            }
        }
    }

    /// Visible segment of the cerulean line + its opacity for the given row.
    /// Mirrors the desktop CSS keyframes in `BrettMark.tsx`:
    ///   0–8%   : hidden (off-screen start)
    ///   8–38%  : drawing in from 0 to full length
    ///   38–68% : fully drawn, held at opacity 1
    ///   68–100%: retracting from the left, fading out
    ///
    /// Static mode returns the full line at `baseOpacity * 0.85`.
    private func lineState(
        row: Int,
        baseOpacity: Double,
        lineLen: CGFloat,
        now: TimeInterval?
    ) -> (CGFloat, CGFloat, Double) {
        guard let now else {
            return (0, lineLen, baseOpacity * 0.85)
        }

        let period: Double = 1.8
        let stagger: Double = Double(row) * 0.15
        let raw = ((now - stagger) / period).truncatingRemainder(dividingBy: 1)
        let t = raw < 0 ? raw + 1 : raw

        let visibleStart: CGFloat
        let visibleEnd: CGFloat
        let opacityMul: Double

        if t < 0.08 {
            visibleStart = 0
            visibleEnd = 0
            opacityMul = 0.3
        } else if t < 0.38 {
            let p = (t - 0.08) / 0.30
            let eased = easeOutQuint(p)
            visibleStart = 0
            visibleEnd = lineLen * CGFloat(eased)
            opacityMul = 0.3 + 0.7 * eased
        } else if t < 0.68 {
            visibleStart = 0
            visibleEnd = lineLen
            opacityMul = 1.0
        } else {
            let p = (t - 0.68) / 0.32
            let eased = easeOutQuint(p)
            visibleStart = lineLen * CGFloat(eased)
            visibleEnd = lineLen
            opacityMul = 1.0 - 0.7 * eased
        }

        return (visibleStart, visibleEnd, baseOpacity * opacityMul)
    }

    private func easeOutQuint(_ t: Double) -> Double {
        let c = max(0, min(1, t))
        return 1 - pow(1 - c, 5)
    }
}

#Preview {
    ZStack {
        Color(red: 10/255, green: 10/255, blue: 10/255)
        VStack(spacing: 24) {
            BrettsMark(size: 16)
            BrettsMark(size: 24)
            BrettsMark(size: 40)
            BrettsMark(size: 24, thinking: true)
        }
    }
    .frame(width: 200, height: 300)
}
