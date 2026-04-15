import SwiftUI

/// Embedded-tweet preview styled to feel like a native Twitter/X card.
///
/// Rendering:
/// - Cerulean-bordered glass card with a generic 𝕏 glyph (we don't sync
///   avatars today, so using a brand glyph keeps the card honest).
/// - Tweet text at 16pt with 1.4× line height.
/// - Optional inline media from `contentImageUrl`.
/// - Tap opens the tweet's original URL in `SafariView`.
struct TweetPreview: View {
    let item: Item
    var onOpenURL: (URL) -> Void

    private var handle: String? {
        if let metadata = item.contentMetadataDecoded,
           let username = metadata["username"] as? String {
            return "@\(username)"
        }
        return nil
    }

    private var timestampText: String? {
        if let metadata = item.contentMetadataDecoded,
           let iso = metadata["timestamp"] as? String {
            return iso
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            profileRow

            if let body = item.contentBody, !body.isEmpty {
                Text(body)
                    .font(.system(size: 16))
                    .foregroundStyle(Color.white.opacity(0.92))
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let description = item.contentDescription, !description.isEmpty {
                Text(description)
                    .font(.system(size: 16))
                    .foregroundStyle(Color.white.opacity(0.92))
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let imageString = item.contentImageUrl,
               let url = URL(string: imageString) {
                media(url: url)
            }

            viewOnX
        }
        .padding(16)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.thinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(BrettColors.cerulean.opacity(0.06))
                }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(BrettColors.cerulean.opacity(0.35), lineWidth: 1)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if let raw = item.sourceUrl, let url = URL(string: raw) {
                HapticManager.light()
                onOpenURL(url)
            }
        }
    }

    // MARK: - Profile

    @ViewBuilder
    private var profileRow: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(BrettColors.cerulean.opacity(0.18))
                    .frame(width: 38, height: 38)
                Circle()
                    .strokeBorder(BrettColors.cerulean.opacity(0.40), lineWidth: 1)
                    .frame(width: 38, height: 38)
                Text("\u{1D54F}") // mathematical double-struck capital X (𝕏)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(BrettColors.cerulean)
            }

            VStack(alignment: .leading, spacing: 2) {
                if let handle {
                    Text(handle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(BrettColors.textCardTitle)
                } else if let domain = item.contentDomain {
                    Text(domain)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(BrettColors.textCardTitle)
                } else {
                    Text("Tweet")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(BrettColors.textCardTitle)
                }

                if let timestampText {
                    Text(timestampText)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.white.opacity(0.40))
                }
            }

            Spacer()

            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(BrettColors.cerulean.opacity(0.60))
        }
    }

    // MARK: - Media

    @ViewBuilder
    private func media(url: URL) -> some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            case .empty, .failure:
                Color.white.opacity(0.06)
                    .overlay {
                        Image(systemName: "photo")
                            .foregroundStyle(Color.white.opacity(0.20))
                    }
            @unknown default:
                Color.white.opacity(0.06)
            }
        }
        .aspectRatio(16.0/10.0, contentMode: .fill)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        }
    }

    // MARK: - Footer

    @ViewBuilder
    private var viewOnX: some View {
        if item.sourceUrl != nil {
            HStack(spacing: 4) {
                Text("View on X")
                    .font(.system(size: 12, weight: .medium))
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(BrettColors.cerulean.opacity(0.90))
        }
    }
}
