import SwiftUI

/// Podcast card with album art and episode chrome.
///
/// - Square album art at 100pt with rounded corners.
/// - Title → show name → duration stack.
/// - Amber accent reflects the "audio" domain (matches desktop styling).
/// - Tap opens the source URL in `SafariView`.
struct PodcastPreview: View {
    let item: Item
    var onOpenURL: (URL) -> Void

    private var podcastName: String? {
        item.contentMetadataDecoded?["podcastName"] as? String
            ?? item.contentDomain
    }

    private var duration: String? {
        if let seconds = item.contentMetadataDecoded?["durationSeconds"] as? Int {
            return formatDuration(seconds)
        }
        return item.contentMetadataDecoded?["duration"] as? String
    }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            albumArt

            VStack(alignment: .leading, spacing: 6) {
                labelPill

                if let title = item.contentTitle, !title.isEmpty {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(BrettColors.textCardTitle)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                metaStack

                Spacer(minLength: 0)

                openOnRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .frame(minHeight: 128)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.thinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(BrettColors.amber400.opacity(0.05))
                }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            if let raw = item.sourceUrl, let url = URL(string: raw) {
                HapticManager.light()
                onOpenURL(url)
            }
        }
    }

    // MARK: - Album art

    @ViewBuilder
    private var albumArt: some View {
        ZStack {
            if let imageString = item.contentImageUrl,
               let url = URL(string: imageString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(contentMode: .fill)
                    case .empty, .failure:
                        albumPlaceholder
                    @unknown default:
                        albumPlaceholder
                    }
                }
            } else {
                albumPlaceholder
            }
        }
        .frame(width: 100, height: 100)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
        }
    }

    @ViewBuilder
    private var albumPlaceholder: some View {
        ZStack {
            LinearGradient(
                colors: [
                    BrettColors.amber400.opacity(0.25),
                    BrettColors.amber400.opacity(0.08)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Image(systemName: "headphones")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(BrettColors.amber400)
        }
    }

    // MARK: - Chrome

    @ViewBuilder
    private var labelPill: some View {
        Text("PODCAST")
            .font(.system(size: 10, weight: .semibold))
            .tracking(2.0)
            .foregroundStyle(BrettColors.amber400.opacity(0.95))
    }

    @ViewBuilder
    private var metaStack: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let podcastName {
                Text(podcastName)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.60))
                    .lineLimit(1)
            }
            if let duration {
                HStack(spacing: 4) {
                    Image(systemName: "clock")
                        .font(.system(size: 10, weight: .semibold))
                    Text(duration)
                        .font(.system(size: 12))
                }
                .foregroundStyle(Color.white.opacity(0.45))
            }
        }
    }

    @ViewBuilder
    private var openOnRow: some View {
        HStack(spacing: 4) {
            Text("Listen")
                .font(.system(size: 12, weight: .medium))
            Image(systemName: "arrow.up.right")
                .font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(BrettColors.amber400.opacity(0.90))
        .padding(.top, 2)
    }

    private func formatDuration(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        return "\(minutes) min"
    }
}
