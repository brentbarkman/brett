import SwiftUI

struct BackgroundView: View {
    var body: some View {
        ZStack {
            // Deep navy-black base
            Color(red: 0.04, green: 0.05, blue: 0.09)

            // Atmospheric gradient — visible, moody, not flat
            LinearGradient(
                stops: [
                    .init(color: Color(red: 0.06, green: 0.10, blue: 0.20), location: 0.0),
                    .init(color: Color(red: 0.08, green: 0.14, blue: 0.26), location: 0.3),
                    .init(color: Color(red: 0.05, green: 0.08, blue: 0.16), location: 0.6),
                    .init(color: Color(red: 0.03, green: 0.04, blue: 0.08), location: 1.0),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            // Warm ambient glow — hints at golden hour
            RadialGradient(
                colors: [
                    BrettColors.gold.opacity(0.06),
                    Color.clear,
                ],
                center: .init(x: 0.8, y: 0.15),
                startRadius: 50,
                endRadius: 350
            )

            // Cool ambient glow — depth
            RadialGradient(
                colors: [
                    BrettColors.cerulean.opacity(0.05),
                    Color.clear,
                ],
                center: .init(x: 0.2, y: 0.7),
                startRadius: 80,
                endRadius: 400
            )

            // Top vignette for status bar
            VStack {
                LinearGradient(
                    colors: [Color.black.opacity(0.5), Color.clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 100)
                Spacer()
            }

            // Bottom vignette for omnibar
            VStack {
                Spacer()
                LinearGradient(
                    colors: [Color.clear, Color.black.opacity(0.5)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 120)
            }
        }
        .ignoresSafeArea()
    }
}
