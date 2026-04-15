import SwiftUI

struct BackgroundView: View {
    /// Which background to show. Defaults to time-aware selection.
    var imageName: String? = nil

    /// The image actually being rendered. Changing this triggers the
    /// crossfade animation, so we drive it from `.onAppear` / a timer rather
    /// than recomputing on every render.
    @State private var displayedImageName: String = ""

    /// Poll the time-of-day bucket every minute so the background crossfades
    /// as dawn → morning → golden → evening → night boundaries tick over.
    ///
    /// A full re-render every minute is cheap — the `Image` is cached, and
    /// SwiftUI skips the work if `displayedImageName` doesn't actually
    /// change.
    private let tick = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    private var currentTimeOfDayImage: String {
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
            // Photo background — fill the screen, anchor to center.
            //
            // We key the Image on its name so SwiftUI's implicit animation
            // applies a crossfade when `displayedImageName` changes. 1500 ms
            // ease-in-out matches the spec's dawn-crossfade timing.
            GeometryReader { geo in
                Image(displayedImageName.isEmpty ? currentTimeOfDayImage : displayedImageName)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
                    .id(displayedImageName.isEmpty ? currentTimeOfDayImage : displayedImageName)
                    .transition(.opacity)
            }
            .ignoresSafeArea()
            .animation(crossfadeAnimation, value: displayedImageName)

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
        .onAppear {
            // Establish the initial image *without* animation so the view
            // doesn't fade in from nothing on first render.
            if displayedImageName.isEmpty {
                displayedImageName = currentTimeOfDayImage
            }
        }
        .onReceive(tick) { _ in
            let next = currentTimeOfDayImage
            guard next != displayedImageName else { return }
            displayedImageName = next
        }
    }

    /// 1.5 s ease-in-out crossfade, or `nil` when Reduce Motion is on so the
    /// image swap is instant.
    private var crossfadeAnimation: Animation? {
        BrettAnimation.isReduceMotionEnabled
            ? nil
            : .easeInOut(duration: 1.5)
    }
}
