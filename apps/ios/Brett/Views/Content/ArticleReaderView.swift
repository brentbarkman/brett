import SwiftUI

/// Full-screen magazine reader for newsletters and articles. Presented via
/// a push transition from `ContentPreview`.
///
/// Layout:
/// - Hero image (16:9) if present, edge-to-edge with vignette
/// - Title + byline stack
/// - Markdown-rendered body with proper typography (15pt, 1.5 line-height)
/// - Bottom actions: "Open original" (external) + "Ask Brett" (AI pivot)
///
/// Body markdown is parsed via `MarkdownRenderer` so headings, lists, bold,
/// italic, code spans, and links all render. Links tapped inside the body
/// open in `SafariView` without leaving the reader.
struct ArticleReaderView: View {
    let item: Item

    @Environment(\.dismiss) private var dismiss
    @State private var externalURL: IdentifiedURL?

    // Pull the best body source: extracted markdown first, then the
    // stored description, then short-circuit to an empty state.
    private var bodyMarkdown: String? {
        if let body = item.contentBody, !body.isEmpty { return body }
        if let description = item.contentDescription, !description.isEmpty {
            return description
        }
        return nil
    }

    private var sourceURL: URL? {
        if let raw = item.sourceUrl, let url = URL(string: raw) { return url }
        return nil
    }

    var body: some View {
        ZStack {
            BackgroundView()

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    hero

                    VStack(alignment: .leading, spacing: 22) {
                        titleStack

                        if let markdown = bodyMarkdown {
                            MarkdownRenderer(
                                source: markdown,
                                style: .article
                            ) { url in
                                externalURL = IdentifiedURL(url: url)
                            }
                        } else {
                            Text("No extracted content for this article.")
                                .font(.system(size: 15))
                                .foregroundStyle(Color.white.opacity(0.50))
                        }

                        actionRow
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 20)
                    .padding(.bottom, 40)
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(BrettColors.textCardTitle)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                if let url = sourceURL {
                    Button {
                        externalURL = IdentifiedURL(url: url)
                    } label: {
                        Image(systemName: "safari")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(BrettColors.gold)
                    }
                }
            }
        }
        .sheet(item: $externalURL) { identified in
            SafariView(url: identified.url)
                .ignoresSafeArea()
        }
    }

    // MARK: - Hero

    @ViewBuilder
    private var hero: some View {
        if let imageString = item.contentImageUrl,
           let url = URL(string: imageString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .empty, .failure:
                    Color.white.opacity(0.05)
                @unknown default:
                    Color.white.opacity(0.05)
                }
            }
            .aspectRatio(16.0/9.0, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .clipped()
            .overlay {
                LinearGradient(
                    colors: [.clear, Color.black.opacity(0.35)],
                    startPoint: .center,
                    endPoint: .bottom
                )
            }
        }
    }

    // MARK: - Title + byline

    @ViewBuilder
    private var titleStack: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title = item.contentTitle ?? (item.title.isEmpty ? nil : item.title) {
                Text(title)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(BrettColors.textHeading)
                    .fixedSize(horizontal: false, vertical: true)
            }

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
                    .frame(width: 18, height: 18)
                    .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
                }

                if let domain = item.contentDomain {
                    Text(domain)
                        .font(.system(size: 14))
                        .foregroundStyle(Color.white.opacity(0.60))
                }

                Spacer()

                if let typeLabel = typeLabel {
                    Text(typeLabel)
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(1.2)
                        .foregroundStyle(BrettColors.cerulean.opacity(0.90))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(BrettColors.cerulean.opacity(0.15)))
                }
            }
        }
    }

    private var typeLabel: String? {
        switch ContentType(rawValue: item.contentType ?? "") {
        case .newsletter: return "NEWSLETTER"
        case .article: return "ARTICLE"
        case .webPage: return "PAGE"
        default: return nil
        }
    }

    // MARK: - Actions

    @ViewBuilder
    private var actionRow: some View {
        HStack(spacing: 10) {
            if let url = sourceURL {
                Button {
                    HapticManager.light()
                    externalURL = IdentifiedURL(url: url)
                } label: {
                    actionLabel(
                        icon: "arrow.up.right.square",
                        text: "Open original"
                    )
                }
                .buttonStyle(.plain)
            }

            Spacer()
        }
        .padding(.top, 8)
    }

    @ViewBuilder
    private func actionLabel(icon: String, text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
            Text(text)
                .font(.system(size: 13, weight: .medium))
        }
        .foregroundStyle(Color.white.opacity(0.85))
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(
            Capsule().fill(Color.white.opacity(0.10))
        )
        .overlay(
            Capsule().strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
        )
    }
}
