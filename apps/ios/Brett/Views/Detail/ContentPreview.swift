import SwiftUI

/// Switchboard for content-type-specific previews inside `TaskDetailView`.
///
/// The prior implementation did all the variant rendering inline. This file
/// now only dispatches to a dedicated `*Preview` view per `contentType`
/// — each lives in `Views/Content/` and handles its own layout, tap
/// gestures, and external URL routing.
///
/// State owned here:
///  - `externalURL`: the target of any tapped link; presented in `SafariView`.
///  - `readerItem`: the newsletter/article the user tapped into; pushed via
///    a programmatic nav link so the reader renders full-screen.
struct ContentPreview: View {
    let item: Item

    @State private var externalURL: IdentifiedURL?
    @State private var isPresentingReader: Bool = false

    var body: some View {
        // No meaningful content → render nothing at all. Keeps the detail
        // view visually tight for plain tasks.
        if hasRenderableContent {
            content
                .sheet(item: $externalURL) { identified in
                    SafariView(url: identified.url)
                        .ignoresSafeArea()
                }
                .fullScreenCover(isPresented: $isPresentingReader) {
                    NavigationStack {
                        ArticleReaderView(item: item)
                    }
                }
        }
    }

    /// Failed extractions render an explicit error card with an "Open
    /// original" link, mirroring the desktop `ErrorState`. Without this,
    /// failed items fell through into the per-type variant which showed
    /// a misleading empty card (e.g. "Tweet content unavailable") with
    /// no signal that anything went wrong server-side.
    @ViewBuilder
    private var content: some View {
        if item.contentStatus == ContentStatus.failed.rawValue {
            extractionFailedCard
        } else {
            variant
        }
    }

    @ViewBuilder
    private var extractionFailedCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(Color(red: 0.95, green: 0.70, blue: 0.20).opacity(0.85))
                Text("Preview unavailable")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.65))
            }
            if let raw = item.sourceUrl, let url = URL(string: raw) {
                Button {
                    HapticManager.light()
                    externalURL = IdentifiedURL(url: url)
                } label: {
                    HStack(spacing: 4) {
                        Text("Open original")
                            .font(.system(size: 12, weight: .medium))
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .foregroundStyle(BrettColors.cerulean.opacity(0.90))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(.thinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.white.opacity(0.03))
                }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
        }
    }

    // MARK: - Dispatch

    @ViewBuilder
    private var variant: some View {
        switch resolvedType {
        case .newsletter, .article:
            NewsletterPreview(item: item) {
                isPresentingReader = true
            }
        case .tweet:
            TweetPreview(item: item) { url in
                externalURL = IdentifiedURL(url: url)
            }
        case .pdf:
            PDFPreview(item: item, onOpen: openPDF)
        case .video:
            VideoPreview(item: item) { url in
                externalURL = IdentifiedURL(url: url)
            }
        case .podcast:
            PodcastPreview(item: item) { url in
                externalURL = IdentifiedURL(url: url)
            }
        case .webPage:
            WebPagePreview(item: item) { url in
                externalURL = IdentifiedURL(url: url)
            }
        case .none:
            // Has content fields (title/description) but no type — treat
            // it as a generic web page card.
            WebPagePreview(item: item) { url in
                externalURL = IdentifiedURL(url: url)
            }
        }
    }

    // MARK: - Derived state

    /// Rule for "should this component render at all":
    /// Either the server told us what type it is, OR we have any of
    /// title / description / body / image / domain to show.
    private var hasRenderableContent: Bool {
        item.contentType != nil
            || (item.contentTitle?.isEmpty == false)
            || (item.contentDescription?.isEmpty == false)
            || (item.contentBody?.isEmpty == false)
            || (item.contentImageUrl?.isEmpty == false)
            || (item.contentDomain?.isEmpty == false)
    }

    /// Public for tests — lets us verify the dispatch table without
    /// touching SwiftUI.
    var resolvedType: ContentType? {
        ContentType(rawValue: item.contentType ?? "")
    }

    // MARK: - Actions

    private func openPDF() {
        // For the W4 pass, PDFs that came from a remote `sourceUrl` open in
        // Safari. Locally-cached PDFs (attachment downloads) get Quick Look
        // via `AttachmentsSection`. A future pass can hoist that handling
        // up here by injecting the downloader — out of scope for this polish.
        if let raw = item.sourceUrl, let url = URL(string: raw) {
            externalURL = IdentifiedURL(url: url)
        }
    }
}
