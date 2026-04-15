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

#Preview {
    LaunchView()
}
