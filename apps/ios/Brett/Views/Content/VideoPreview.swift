import SwiftUI

/// Hero-thumbnail video preview with a centered play glyph overlay.
///
/// - Aspect ratio: 16:9 to match YouTube/Vimeo thumbnails exactly.
/// - Duration badge floats bottom-right in `00:00` format when metadata
///   has it (`durationSeconds`).
/// - Tapping opens the source URL in `SafariView` (routed via callback).
struct VideoPreview: View {
    let item: Item
    var onOpenURL: (URL) -> Void

    private var duration: String? {
        if let seconds = item.contentMetadataDecoded?["durationSeconds"] as? Int {
            return formatDuration(seconds)
        }
        if let raw = item.contentMetadataDecoded?["duration"] as? String {
            return raw
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            thumbnail

            VStack(alignment: .leading, spacing: 6) {
                if let title = item.contentTitle, !title.isEmpty {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(BrettColors.textCardTitle)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                footerRow
            }
            .padding(14)
        }
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.thinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(BrettColors.purple400.opacity(0.06))
                }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture {
            if let raw = item.sourceUrl, let url = URL(string: raw) {
                HapticManager.light()
                onOpenURL(url)
            }
        }
    }

    // MARK: - Thumbnail

    @ViewBuilder
    private var thumbnail: some View {
        ZStack {
            if let imageString = item.contentImageUrl,
               let url = URL(string: imageString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(contentMode: .fill)
                    case .empty, .failure:
                        placeholder
                    @unknown default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }

            // Subtle darkening so the play icon always reads.
            LinearGradient(
                colors: [Color.black.opacity(0.10), Color.black.opacity(0.35)],
                startPoint: .top,
                endPoint: .bottom
            )

            playOverlay

            if let duration {
                VStack { Spacer()
                    HStack { Spacer()
                        Text(duration)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .fill(Color.black.opacity(0.72))
                            )
                    }
                }
                .padding(8)
            }
        }
        .aspectRatio(16.0/9.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipped()
    }

    @ViewBuilder
    private var placeholder: some View {
        ZStack {
            Rectangle().fill(Color.white.opacity(0.06))
            Image(systemName: "film")
                .font(.system(size: 28))
                .foregroundStyle(Color.white.opacity(0.20))
        }
    }

    @ViewBuilder
    private var playOverlay: some View {
        ZStack {
            Circle()
                .fill(Color.black.opacity(0.45))
                .frame(width: 54, height: 54)
            Circle()
                .strokeBorder(Color.white.opacity(0.80), lineWidth: 1.5)
                .frame(width: 54, height: 54)
            Image(systemName: "play.fill")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Color.white)
                .offset(x: 2) // optical nudge — triangle weight skews left
        }
    }

    // MARK: - Footer

    @ViewBuilder
    private var footerRow: some View {
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
                .frame(width: 14, height: 14)
                .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
            }

            if let domain = item.contentDomain {
                Text(domain)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.50))
            }

            Spacer()

            Image(systemName: "arrow.up.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(BrettColors.purple400.opacity(0.85))
        }
    }

    // MARK: - Helpers

    private func formatDuration(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let secs = seconds % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%d:%02d", minutes, secs)
    }
}
