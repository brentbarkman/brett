import SwiftUI

/// Editorial 38pt serif page header used across Inbox, Calendar, Lists,
/// and Scouts (and a flavor on Today's hero). Calm-hero design
/// (2026-05-04 spec) replaces the prior 28pt `BrettTypography.dateHeader`
/// for top-level page titles — the larger serif treatment carries the
/// editorial polish the user signed off on, and parity across pages
/// keeps the swipe-between-views feel cohesive.
///
/// Two variants of the same shape:
///  - `.onWash` — for non-Today pages sitting on the solid wash. No
///    text shadow needed.
///  - `.onPhoto` — for the Today hero where the header sits over the
///    background photo. Layered text-shadow keeps the title readable
///    against any photo in the manifest.
struct EditorialPageHeader: View {
    let title: String
    let subtitle: String?
    var variant: Variant = .onWash
    /// Inset from the leading edge. `BrettSpacing.pagePaddingX` (20pt)
    /// aligns the title with the section-header text that sits below
    /// it on every calm-hero page — sticky-card sections place their
    /// header at 16pt card padding + 4pt internal = 20pt from the
    /// screen edge, and the header used to be 4pt further right than
    /// those headers at 24pt. Settings nests the header inside
    /// `BrettSettingsScroll` (which already pads 16pt for cards), so
    /// it passes 0 here to avoid compounding.
    var horizontalPadding: CGFloat = BrettSpacing.pagePaddingX

    enum Variant {
        case onWash
        case onPhoto
    }

    /// Reactive read of the shared awakening opacity. Editorial
    /// headers ride the slower awakening fade so the hero band
    /// blooms in after the workspace lands — see `Awakening` in
    /// `MainContainer.swift`.
    @State private var awakening = AwakeningState.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 38, weight: .regular, design: .serif))
                .foregroundStyle(.white)
                .modifier(PhotoLegibilityShadow(active: variant == .onPhoto))

            if let subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.70))
                    .modifier(PhotoLegibilityShadow(active: variant == .onPhoto))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, horizontalPadding)
        .opacity(awakening.heroOpacity)
    }
}

/// Layered shadow for hero text sitting over a photo. Tight 1pt outline
/// + soft 8pt halo — same trick the v18 mockup uses for the brief copy.
/// Skipped entirely when off so non-hero headers don't pay the rendering
/// cost.
private struct PhotoLegibilityShadow: ViewModifier {
    let active: Bool

    func body(content: Content) -> some View {
        if active {
            content
                .shadow(color: Color.black.opacity(0.40), radius: 1, x: 0, y: 0)
                .shadow(color: Color.black.opacity(0.30), radius: 8, x: 0, y: 2)
        } else {
            content
        }
    }
}

#if DEBUG
#Preview("On wash") {
    ZStack {
        WashBackground()
        EditorialPageHeader(title: "Inbox", subtitle: "3 to triage")
            .frame(maxHeight: .infinity, alignment: .top)
            .padding(.top, 60)
    }
    .preferredColorScheme(.dark)
}

#Preview("On photo") {
    ZStack {
        Image(systemName: "photo.fill")
            .resizable()
            .aspectRatio(contentMode: .fill)
            .ignoresSafeArea()
        EditorialPageHeader(
            title: "Tuesday morning",
            subtitle: "May 4",
            variant: .onPhoto
        )
        .frame(maxHeight: .infinity, alignment: .top)
        .padding(.top, 60)
    }
    .preferredColorScheme(.dark)
}
#endif
