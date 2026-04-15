import SwiftUI

/// Generic link card — the fallback for any content Brett hasn't classified
/// as a newsletter, article, tweet, PDF, video, or podcast.
///
/// Pattern: favicon + title + domain above a 2-line description snippet,
/// with a trailing open chevron. Tapping opens `SafariView`.
struct WebPagePreview: View {
    let item: Item
    var onOpenURL: (URL) -> Void

    var body: some View {
        Button {
            if let raw = item.sourceUrl, let url = URL(string: raw) {
                HapticManager.light()
                onOpenURL(url)
            }
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                headerRow

                if let title = item.contentTitle, !title.isEmpty {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(BrettColors.textCardTitle)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let description = item.contentDescription, !description.isEmpty {
                    Text(description)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.white.opacity(0.65))
                        .lineSpacing(3)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let imageString = item.contentImageUrl,
                   let url = URL(string: imageString) {
                    AsyncImage(url: url) { phase in
                        if case .success(let image) = phase {
                            image.resizable().aspectRatio(contentMode: .fill)
                        } else {
                            Color.white.opacity(0.05)
                        }
                    }
                    .aspectRatio(16.0/9.0, contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.thinMaterial)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var headerRow: some View {
        HStack(spacing: 8) {
            favicon

            if let domain = item.contentDomain {
                Text(domain)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.50))
                    .lineLimit(1)
            }

            Spacer()

            Image(systemName: "arrow.up.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.35))
        }
    }

    @ViewBuilder
    private var favicon: some View {
        Group {
            if let faviconString = item.contentFavicon,
               let url = URL(string: faviconString) {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().aspectRatio(contentMode: .fit)
                    } else {
                        fallbackFavicon
                    }
                }
            } else {
                fallbackFavicon
            }
        }
        .frame(width: 16, height: 16)
        .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
    }

    @ViewBuilder
    private var fallbackFavicon: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(Color.white.opacity(0.10))
            Image(systemName: "globe")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.45))
        }
    }
}
