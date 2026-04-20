import SwiftUI

/// Styled wordmark: assistant name in Plus Jakarta Sans ExtraBold with a
/// metallic gold vertical gradient, plus a cerulean underline bar.
///
/// Pixel-parity port of `packages/ui/src/BrettMark.tsx#Wordmark`. Desktop
/// values: 180° gold gradient (#F5D96B → #D4A020), 0.03em letter-spacing,
/// 2.5pt bar at 65% width with a cerulean → transparent horizontal gradient.
///
/// Requires `PlusJakartaSans-ExtraBold.ttf` bundled via
/// `Info.plist#UIAppFonts`. Falls back to SF Pro Rounded Black if the font
/// fails to load for any reason so the UI never renders bare.
struct BrettWordmark: View {
    let name: String
    var size: CGFloat = 19
    var isWorking: Bool = false

    @State private var breathe: Bool = false

    private static let goldGradient = LinearGradient(
        colors: [
            Color(red: 245/255, green: 217/255, blue: 107/255),
            Color(red: 212/255, green: 160/255, blue: 32/255),
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    private static let ceruleanGradient = LinearGradient(
        stops: [
            .init(color: Color(red: 70/255, green: 130/255, blue: 195/255), location: 0.0),
            .init(color: Color(red: 90/255, green: 154/255, blue: 214/255), location: 0.70),
            .init(color: .clear, location: 1.0),
        ],
        startPoint: .leading,
        endPoint: .trailing
    )

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(name)
                .font(Self.font(size: size))
                .tracking(size * 0.03)
                .lineLimit(1)
                .truncationMode(.tail)
                .foregroundStyle(Self.goldGradient)
                .frame(maxWidth: 140, alignment: .leading)

            GeometryReader { geo in
                Capsule()
                    .fill(Self.ceruleanGradient)
                    .frame(width: geo.size.width * 0.65, height: 2.5)
                    .opacity(isWorking ? (breathe ? 1.0 : 0.45) : 0.55)
            }
            .frame(height: 2.5)
        }
        .onAppear {
            guard isWorking else { return }
            withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) {
                breathe = true
            }
        }
    }

    private static func font(size: CGFloat) -> Font {
        // PostScript name is verified in the TTF's `name` table (id=6).
        // If the bundled font isn't registered (e.g. in a preview with no
        // plist), Font.custom silently substitutes — we pair with a system
        // fallback for belt-and-braces.
        .custom("PlusJakartaSans-ExtraBold", fixedSize: size)
    }
}

#Preview {
    ZStack {
        Color.black.ignoresSafeArea()
        VStack(spacing: 20) {
            BrettWordmark(name: "Brett")
            BrettWordmark(name: "Jarvis", size: 24)
            BrettWordmark(name: "Brett", isWorking: true)
        }
    }
}
