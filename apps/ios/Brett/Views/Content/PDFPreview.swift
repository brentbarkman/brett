import SwiftUI

/// Preview card for items whose `contentType` is `.pdf`. Shows a red PDF
/// badge, filename, size, and page count (if metadata has it). Tapping
/// opens a `QuickLookView`-hosted preview.
///
/// Two flavours:
///  - **Cached attachment already on disk** → tap opens instantly.
///  - **Remote URL only** → tap opens the source in Safari; the caller
///    (ContentPreview) is responsible for swapping in a `QuickLookView`
///    if we later add on-demand download.
struct PDFPreview: View {
    let item: Item

    /// URL of a locally-cached copy if the file has been downloaded. When
    /// set, tapping opens Quick Look; when nil, tapping opens source URL.
    var localURL: URL?

    /// True while the downloader is fetching the file. Shows a gold
    /// progress bar in the card.
    var isDownloading: Bool = false

    /// Progress 0.0 … 1.0 while downloading.
    var downloadProgress: Double = 0

    /// Callback for open action. Caller decides how to route based on state.
    var onOpen: () -> Void

    private var filename: String {
        if let title = item.contentTitle, !title.isEmpty { return title }
        if !item.title.isEmpty { return item.title }
        return "Untitled.pdf"
    }

    private var pageCount: Int? {
        item.contentMetadataDecoded?["pageCount"] as? Int
    }

    private var fileSize: Int? {
        item.contentMetadataDecoded?["sizeBytes"] as? Int
    }

    var body: some View {
        Button {
            HapticManager.light()
            onOpen()
        } label: {
            HStack(spacing: 14) {
                pdfBadge

                VStack(alignment: .leading, spacing: 4) {
                    Text("PDF")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(2.4)
                        .foregroundStyle(BrettColors.error.opacity(0.80))

                    Text(filename)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(BrettColors.textCardTitle)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    metaRow
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                chevronOrSpinner
            }
            .padding(16)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.thinMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(BrettColors.error.opacity(0.06))
                    }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(BrettColors.error.opacity(0.22), lineWidth: 1)
            }
            .overlay(alignment: .bottom) {
                if isDownloading {
                    ProgressView(value: downloadProgress)
                        .progressViewStyle(.linear)
                        .tint(BrettColors.gold)
                        .frame(height: 2)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 4)
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Badge

    @ViewBuilder
    private var pdfBadge: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(BrettColors.error.opacity(0.16))
                .frame(width: 48, height: 56)

            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(BrettColors.error.opacity(0.40), lineWidth: 1)
                .frame(width: 48, height: 56)

            VStack(spacing: 2) {
                Image(systemName: "doc.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(BrettColors.error)
                Text("PDF")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(BrettColors.error)
            }
        }
    }

    // MARK: - Meta

    @ViewBuilder
    private var metaRow: some View {
        let parts: [String] = {
            var list: [String] = []
            if let size = fileSize {
                list.append(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
            }
            if let count = pageCount {
                list.append(count == 1 ? "1 page" : "\(count) pages")
            }
            if let domain = item.contentDomain, list.isEmpty {
                list.append(domain)
            }
            return list
        }()

        if !parts.isEmpty {
            Text(parts.joined(separator: "  \u{2022}  "))
                .font(.system(size: 12))
                .foregroundStyle(Color.white.opacity(0.50))
        } else if isDownloading {
            Text("Preparing…")
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.gold.opacity(0.90))
        }
    }

    // MARK: - Trailing

    @ViewBuilder
    private var chevronOrSpinner: some View {
        if isDownloading {
            ProgressView()
                .controlSize(.small)
                .tint(BrettColors.gold)
        } else {
            Image(systemName: localURL != nil ? "eye" : "arrow.up.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.50))
                .frame(width: 32, height: 32)
                .background(Color.white.opacity(0.08), in: Circle())
        }
    }
}
