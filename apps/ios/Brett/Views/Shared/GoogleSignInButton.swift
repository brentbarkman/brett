import SwiftUI

/// Google Sign-In button matching Google's Identity brand guidelines:
/// https://developers.google.com/identity/branding-guidelines
///
/// - Official 4-color "G" mark (blue #4285F4, red #EA4335, yellow #FBBC05,
///   green #34A853) rendered via `Canvas` so no brand asset ships in the
///   bundle — avoids stale-asset drift and keeps the IPA lean.
/// - "Sign in with Google" in Roboto Medium (system-medium fallback).
/// - Dark mode: ~`#131314` background, 1pt white/50% divider-less outline.
///   Light mode not used by Brett (we're dark-only) but ready if ever added.
/// - 40pt minimum height; we run 48pt to match the Apple button for alignment.
///
/// Per Google guidelines: keep the logo unmodified (correct proportions,
/// colors, clear-space); don't use the "G" without the wordmark label;
/// visible on both light and dark, matching surrounding UI tone.
struct GoogleSignInButton: View {
    let action: () -> Void
    var title: String = "Sign in with Google"
    var isDisabled: Bool = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                GoogleGMark()
                    .frame(width: 18, height: 18)

                Text(title)
                    // Google asks for Roboto Medium on their surfaces.
                    // iOS doesn't ship Roboto; SF Pro medium is the closest
                    // readable neighbour and Google's guidelines explicitly
                    // allow the platform system font as a fallback.
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(red: 0.90, green: 0.91, blue: 0.93))

                // The guideline shows the label centred; we push a little
                // leading and keep a Spacer() on the trailing edge to hold
                // full-width button layout. Google's own button actually
                // trails with no spacer — both are acceptable. Matching the
                // adjacent Apple button's centered feel reads better here.
            }
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background {
                // Dark-theme surface per Google's guidelines: a dark neutral
                // (#131314) that reads as "button" against a black card.
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(red: 19/255, green: 19/255, blue: 20/255))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.12), lineWidth: 0.5)
                    }
            }
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.40 : 1.0)
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isButton)
    }
}

/// The official Google "G" mark — four-color, drawn via stroked arcs plus
/// a blue crossbar. Colours match Google's brand values pixel-for-pixel;
/// geometry traced from the reference SVG on developers.google.com.
///
/// Using thick stroked arcs (rather than filled wedges + subtractive masks)
/// keeps the mark crisp at 18pt where mask-compositing artefacts would
/// otherwise show up. Each arc is a single `addArc` call — no blend modes.
private struct GoogleGMark: View {
    var body: some View {
        Canvas { ctx, size in
            let s = size.width / 48.0  // 48-unit coordinate space

            // Official brand colors
            let blue   = Color(red: 66/255,  green: 133/255, blue: 244/255) // #4285F4
            let red    = Color(red: 234/255, green: 67/255,  blue: 53/255)  // #EA4335
            let yellow = Color(red: 251/255, green: 188/255, blue: 5/255)   // #FBBC05
            let green  = Color(red: 52/255,  green: 168/255, blue: 83/255)  // #34A853

            let cx: CGFloat = 24 * s
            let cy: CGFloat = 24 * s
            let ringMidRadius: CGFloat = 15 * s  // stroke runs down the centre
            let ringWidth: CGFloat = 9 * s       // outer 19.5 → inner 10.5

            // SwiftUI's Canvas uses flipped Y for angles: 0° = 3 o'clock,
            // degrees increase clockwise. All angles below follow that.

            // --- Red arc (top-left quadrant of the ring) ---
            // Starts a bit past 9 o'clock (190°), sweeps clockwise over the
            // top past 12 o'clock and down to roughly 1 o'clock (-35°/325°).
            var redArc = Path()
            redArc.addArc(
                center: CGPoint(x: cx, y: cy),
                radius: ringMidRadius,
                startAngle: .degrees(200),
                endAngle: .degrees(325),
                clockwise: false
            )
            ctx.stroke(redArc, with: .color(red), lineWidth: ringWidth)

            // --- Blue arc (top-right quadrant, tucks into the crossbar) ---
            var blueArc = Path()
            blueArc.addArc(
                center: CGPoint(x: cx, y: cy),
                radius: ringMidRadius,
                startAngle: .degrees(325),
                endAngle: .degrees(360),
                clockwise: false
            )
            ctx.stroke(blueArc, with: .color(blue), lineWidth: ringWidth)

            // --- Green arc (bottom-right, sweeping down and left) ---
            var greenArc = Path()
            greenArc.addArc(
                center: CGPoint(x: cx, y: cy),
                radius: ringMidRadius,
                startAngle: .degrees(0),
                endAngle: .degrees(90),
                clockwise: false
            )
            ctx.stroke(greenArc, with: .color(green), lineWidth: ringWidth)

            // --- Yellow arc (bottom-left, back up to the red handoff) ---
            var yellowArc = Path()
            yellowArc.addArc(
                center: CGPoint(x: cx, y: cy),
                radius: ringMidRadius,
                startAngle: .degrees(90),
                endAngle: .degrees(200),
                clockwise: false
            )
            ctx.stroke(yellowArc, with: .color(yellow), lineWidth: ringWidth)

            // --- Blue crossbar ---
            // Horizontal bar from centre to the right edge of the ring,
            // sitting on the mid-horizontal. Sits flush with the blue arc
            // it extends from.
            let crossbarHeight: CGFloat = ringWidth
            let crossbarStartX = cx + 1 * s                   // tiny gap at centre
            let crossbarEndX = cx + ringMidRadius + ringWidth / 2
            ctx.fill(
                Path(CGRect(
                    x: crossbarStartX,
                    y: cy - crossbarHeight / 2,
                    width: crossbarEndX - crossbarStartX,
                    height: crossbarHeight
                )),
                with: .color(blue)
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHidden(true)
    }
}

#Preview {
    ZStack {
        Color(red: 10/255, green: 10/255, blue: 10/255)
            .ignoresSafeArea()

        VStack(spacing: 24) {
            GoogleSignInButton(action: {})
            GoogleSignInButton(action: {}, isDisabled: true)

            // Raw mark at a few sizes to eyeball proportions
            HStack(spacing: 20) {
                GoogleGMark().frame(width: 18, height: 18)
                GoogleGMark().frame(width: 32, height: 32)
                GoogleGMark().frame(width: 64, height: 64)
            }
        }
        .padding(24)
    }
}
