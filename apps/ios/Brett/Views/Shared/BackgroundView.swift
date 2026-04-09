import SwiftUI

struct BackgroundView: View {
    var body: some View {
        ZStack {
            // Base: dark atmospheric gradient (placeholder for living background)
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.07, blue: 0.12),
                    Color(red: 0.08, green: 0.12, blue: 0.20),
                    Color(red: 0.04, green: 0.06, blue: 0.10),
                ],
                startPoint: .top,
                endPoint: .bottom
            )

            // Subtle texture / noise to avoid flat feel
            // In production, this will be a photograph
            // For now, add subtle color variation
            RadialGradient(
                colors: [
                    Color(red: 0.12, green: 0.18, blue: 0.30).opacity(0.4),
                    Color.clear,
                ],
                center: .topTrailing,
                startRadius: 100,
                endRadius: 500
            )

            // Top vignette for status bar readability
            VStack {
                LinearGradient(
                    colors: [Color.black.opacity(0.6), Color.clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 120)
                Spacer()
            }

            // Bottom vignette for omnibar readability
            VStack {
                Spacer()
                LinearGradient(
                    colors: [Color.clear, Color.black.opacity(0.4)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 140)
            }
        }
        .ignoresSafeArea()
    }
}
