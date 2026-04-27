import SwiftUI

/// Embedded-tweet preview styled to feel like a native Twitter/X card.
///
/// Rendering:
/// - Cerulean-bordered glass card with a generic 𝕏 glyph (we don't sync
///   avatars today, so using a brand glyph keeps the card honest).
/// - Heading title (X Article title or `contentTitle` from server) when
///   meaningful — suppressed when the title is just `Tweet by @handle`,
///   since the @handle row already says that.
/// - Body text from `contentBody` → `contentDescription` → `tweetText` in
///   metadata, in that order.
/// - Optional inline media from `contentImageUrl`.
/// - Tap opens the tweet's source URL via the SwiftUI `\.openURL`
///   environment, which respects Apple's universal-link handoff — if the
///   X app is installed it opens there, otherwise falls back to Safari.
///   `SFSafariViewController` (the default for other content types) bypasses
///   universal links, so we explicitly route around it for tweets.
struct TweetPreview: View {
    let item: Item
    /// Retained for API symmetry with sibling previews. Tweets bypass it
    /// in favour of `\.openURL` so the X universal link can take over.
    var onOpenURL: (URL) -> Void

    @Environment(\.openURL) private var systemOpenURL

    private var meta: ContentMetadata.TweetMeta? { item.tweetMetadata }

    private var handle: String? {
        guard let author = meta?.author, !author.isEmpty else { return nil }
        return "@\(author)"
    }

    /// Server fallback title is `Tweet by @<handle>`; the @handle row
    /// already conveys that, so don't re-render it as a heading. Mirrors
    /// the suppression rule in the desktop ContentPreview.
    private var headingTitle: String? {
        guard let title = item.contentTitle, !title.isEmpty else { return nil }
        if let author = meta?.author, title == "Tweet by @\(author)" { return nil }
        return title
    }

    private var bodyText: String? {
        if let body = item.contentBody, !body.isEmpty { return body }
        if let desc = item.contentDescription, !desc.isEmpty { return desc }
        if let mt = meta?.tweetText, !mt.isEmpty { return mt }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            profileRow

            if let headingTitle {
                Text(headingTitle)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(BrettColors.textCardTitle)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let bodyText {
                Text(bodyText)
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
                // Bypass SafariView for tweets: `systemOpenURL` invokes
                // UIApplication.openURL under the hood, which respects the
                // X app's universal-link claim. SafariView would always
                // render in-app and never hand off.
                systemOpenURL(url)
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
        // Fixed crop height instead of a 16:10 aspect-ratio frame: at full
        // phone width, 16:10 lands at ~244pt and dominates the card. 200pt
        // matches the visual proportion of desktop's `max-h-80` article
        // previews and stops linked-article hero shots from making the
        // tweet card disproportionately tall.
        .frame(maxWidth: .infinity)
        .frame(height: 200)
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
