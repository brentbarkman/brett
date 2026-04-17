import SwiftUI

/// Magazine-style newsletter preview card.
///
/// Features:
/// - Optional full-width hero image (16:9) with a subtle vignette scrim for
///   legibility on bright photography.
/// - Cerulean left accent (2pt) — the "AI curated by Brett" signal.
/// - Byline row with favicon + domain + "Newsletter" pill.
/// - Tap anywhere on the card to push a full-screen reader.
///
/// Rendering is defensive: missing image, description, or favicon each fall
/// back gracefully so a half-extracted item still looks intentional.
struct NewsletterPreview: View {
    let item: Item
    var onOpenReader: () -> Void

    // Tight spacing between hero and text so the image reads like a magazine
    // above-fold shot rather than a thumbnail.
    private let heroAspect: CGFloat = 16.0 / 9.0

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let urlString = item.contentImageUrl,
               let url = URL(string: urlString) {
                heroImage(url: url)
                    .padding(.bottom, 14)
            }

            VStack(alignment: .leading, spacing: 10) {
                bylineRow

                if let title = item.contentTitle, !title.isEmpty {
                    Text(title)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.95))
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let description = item.contentDescription, !description.isEmpty {
                    descriptionWithReadMore(description)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 14)
            .padding(.top, item.contentImageUrl == nil ? 14 : 0)
        }
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.thinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(BrettColors.cerulean.opacity(0.08))
                }
        }
        .overlay(alignment: .leading) {
            // Signature cerulean 2pt edge — the "Brett curated" rail.
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(BrettColors.cerulean.opacity(0.55))
                .frame(width: 2)
                .padding(.vertical, 10)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture {
            HapticManager.light()
            onOpenReader()
        }
    }

    // MARK: - Hero

    @ViewBuilder
    private func heroImage(url: URL) -> some View {
        GeometryReader { geo in
            AsyncImage(url: url) { phase in
                switch phase {
                case .empty:
                    placeholderHero
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure:
                    placeholderHero
                @unknown default:
                    placeholderHero
                }
            }
            .frame(width: geo.size.width, height: geo.size.width / heroAspect)
            .clipped()
            .overlay {
                // Subtle bottom vignette so the title below the image reads
                // well against bright photography.
                LinearGradient(
                    colors: [Color.black.opacity(0.0), Color.black.opacity(0.18)],
                    startPoint: .center,
                    endPoint: .bottom
                )
            }
        }
        .aspectRatio(heroAspect, contentMode: .fit)
    }

    @ViewBuilder
    private var placeholderHero: some View {
        ZStack {
            Rectangle().fill(Color.white.opacity(0.06))
            Image(systemName: "envelope.open")
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(Color.white.opacity(0.20))
        }
    }

    // MARK: - Byline

    @ViewBuilder
    private var bylineRow: some View {
        HStack(spacing: 8) {
            if let faviconString = item.contentFavicon,
               let url = URL(string: faviconString) {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().aspectRatio(contentMode: .fit)
                    } else {
                        Color.white.opacity(0.08)
                    }
                }
                .frame(width: 16, height: 16)
                .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
            } else {
                Image(systemName: "envelope")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(BrettColors.cerulean.opacity(0.80))
                    .frame(width: 16, height: 16)
            }

            if let domain = item.contentDomain {
                Text(domain)
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.40))
                    .lineLimit(1)
            }

            Text("Newsletter")
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(BrettColors.cerulean.opacity(0.90))
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .background(
                    Capsule().fill(BrettColors.cerulean.opacity(0.15))
                )

            Spacer(minLength: 0)
        }
    }

    // MARK: - Description with inline Read more

    @ViewBuilder
    private func descriptionWithReadMore(_ description: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(description)
                .font(.system(size: 14))
                .foregroundStyle(Color.white.opacity(0.70))
                .lineSpacing(3)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 4) {
                Text("Read more")
                    .font(.system(size: 12, weight: .medium))
                Image(systemName: "arrow.right")
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(BrettColors.cerulean.opacity(0.95))
        }
    }
}
