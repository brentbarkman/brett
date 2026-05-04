import SwiftUI

/// Solid "wash" backdrop for non-Today pages (Inbox, Calendar, Lists,
/// Scouts) and the section bed beneath the Today hero.
///
/// Calm-hero design (2026-05-04 spec): the photo is a privilege of the
/// Today home screen. Every other page wears the same solid wash color
/// so the app reads as one product without competing photographic
/// canvases. The wash color comes from `BackgroundService.currentWashColor`
/// — a single source so all consumers stay in lockstep when the wash
/// (eventually) updates with the photo.
///
/// Drop-in replacement for `BackgroundView` on non-hero pages. Owns its
/// own `.ignoresSafeArea()` so callers don't have to remember to extend
/// it under the status bar / home indicator.
struct WashBackground: View {
    @State private var service = BackgroundService.shared

    var body: some View {
        service.currentWashColor
            .ignoresSafeArea()
    }
}

#if DEBUG
#Preview {
    ZStack {
        WashBackground()
        VStack(alignment: .leading, spacing: 8) {
            Text("Inbox")
                .font(.system(size: 38, weight: .regular, design: .serif))
                .foregroundStyle(.white)
            Text("3 to triage")
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.7))
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
    .preferredColorScheme(.dark)
}
#endif
