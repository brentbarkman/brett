import SwiftUI

struct BackgroundView: View {
    /// Which background to show. Defaults to time-aware selection.
    var imageName: String? = nil

    private var resolvedImageName: String {
        if let imageName { return imageName }

        // Simple time-of-day selection for prototype
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<8: return "bg-morning"
        case 8..<12: return "bg-morning"
        case 12..<17: return "bg-golden"
        case 17..<20: return "bg-evening"
        default: return "bg-night"
        }
    }

    var body: some View {
        ZStack {
            // Photo background — fill the screen, anchor to center
            GeometryReader { geo in
                Image(resolvedImageName)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
            }
            .ignoresSafeArea()

            // Top vignette for status bar readability
            VStack {
                LinearGradient(
                    colors: [Color.black.opacity(0.55), Color.clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 140)
                Spacer()
            }

            // Bottom vignette for omnibar readability
            VStack {
                Spacer()
                LinearGradient(
                    colors: [Color.clear, Color.black.opacity(0.55)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 160)
            }

            // Subtle overall darkening to help glass cards pop
            Color.black.opacity(0.15)
        }
        .ignoresSafeArea()
    }
}
