import SwiftUI

/// Header preview for items whose `contentType` is set — i.e. articles,
/// newsletters, videos, tweets, PDFs. Renders above the editable sections
/// so the user has the source in front of them while taking notes.
///
/// This is intentionally lightweight: no inline web view. Links open in
/// Safari; the view's job is to make the source feel present and tappable.
struct ContentPreview: View {
    let item: Item

    var body: some View {
        // Only render when there's meaningful content to show.
        if item.contentType != nil || item.contentTitle != nil || item.contentDescription != nil {
            content
                .glassCard(tint: tintColor)
        }
    }

    // MARK: - Variants

    @ViewBuilder
    private var content: some View {
        switch ContentType(rawValue: item.contentType ?? "") {
        case .article, .webPage:
            articleOrPage
        case .newsletter:
            newsletter
        case .tweet:
            tweet
        case .video:
            video
        case .pdf:
            pdf
        case .podcast:
            podcast
        case .none:
            // contentTitle/description set but no type → treat as article
            articleOrPage
        }
    }

    @ViewBuilder
    private var articleOrPage: some View {
        VStack(alignment: .leading, spacing: 10) {
            contentHeader(typeLabel: label(for: ContentType(rawValue: item.contentType ?? "") ?? .article))

            if let title = item.contentTitle ?? item.contentBody?.prefix(60).description, !title.isEmpty {
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(BrettColors.textCardTitle)
                    .lineLimit(2)
            }

            if let description = item.contentDescription, !description.isEmpty {
                Text(description)
                    .font(.system(size: 12))
                    .foregroundStyle(BrettColors.textBody)
                    .lineSpacing(3)
                    .lineLimit(6)
            }

            if let body = item.contentBody, !body.isEmpty {
                Text(markdown(from: body))
                    .font(.system(size: 13))
                    .foregroundStyle(BrettColors.textBody)
                    .lineSpacing(4)
                    .lineLimit(12)
                    .padding(.top, 4)
            }

            sourceFooter
        }
    }

    @ViewBuilder
    private var newsletter: some View {
        articleOrPage
    }

    @ViewBuilder
    private var tweet: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "quote.bubble")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(BrettColors.cerulean)
                Text("TWEET")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.cerulean.opacity(0.80))
            }

            if let body = item.contentBody, !body.isEmpty {
                Text(body)
                    .font(.system(size: 14))
                    .foregroundStyle(BrettColors.textCardTitle)
                    .lineSpacing(3)
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(BrettColors.cerulean.opacity(0.40))
                            .frame(width: 3)
                    }
            }

            sourceFooter
        }
    }

    @ViewBuilder
    private var video: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(0.08))
                    .frame(width: 80, height: 56)
                Image(systemName: "play.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(BrettColors.purple400)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(item.contentTitle ?? item.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BrettColors.textCardTitle)
                    .lineLimit(2)

                if let domain = item.contentDomain {
                    Text(domain)
                        .font(.system(size: 11))
                        .foregroundStyle(BrettColors.textInactive)
                }

                openInSafariHint
            }

            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .onTapGesture { openSource() }
    }

    @ViewBuilder
    private var pdf: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(BrettColors.error.opacity(0.15))
                    .frame(width: 56, height: 72)
                Image(systemName: "doc.text.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(BrettColors.error)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("PDF")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.sectionLabelColor)

                Text(item.contentTitle ?? item.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BrettColors.textCardTitle)
                    .lineLimit(2)

                openInSafariHint
            }

            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .onTapGesture { openSource() }
    }

    @ViewBuilder
    private var podcast: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(0.08))
                    .frame(width: 56, height: 56)
                Image(systemName: "headphones")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(BrettColors.amber400)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(item.contentTitle ?? item.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BrettColors.textCardTitle)
                    .lineLimit(2)
                if let domain = item.contentDomain {
                    Text(domain)
                        .font(.system(size: 11))
                        .foregroundStyle(BrettColors.textInactive)
                }
                openInSafariHint
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .onTapGesture { openSource() }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func contentHeader(typeLabel: String) -> some View {
        HStack(spacing: 6) {
            if let domain = item.contentDomain {
                Text(domain.uppercased())
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.sectionLabelColor)
            } else {
                Text(typeLabel)
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.sectionLabelColor)
            }
            Spacer()
            if item.sourceUrl != nil {
                openInSafariHint
            }
        }
    }

    @ViewBuilder
    private var sourceFooter: some View {
        if let url = item.sourceUrl, !url.isEmpty {
            Button {
                openSource()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.up.right.square")
                        .font(.system(size: 11, weight: .medium))
                    Text(item.contentDomain ?? url)
                        .font(.system(size: 11))
                        .lineLimit(1)
                }
                .foregroundStyle(BrettColors.cerulean.opacity(0.80))
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private var openInSafariHint: some View {
        HStack(spacing: 3) {
            Image(systemName: "arrow.up.right")
                .font(.system(size: 9, weight: .semibold))
            Text("Open")
                .font(.system(size: 10, weight: .medium))
        }
        .foregroundStyle(BrettColors.textInactive)
    }

    private func openSource() {
        guard let raw = item.sourceUrl, let url = URL(string: raw) else { return }
        UIApplication.shared.open(url)
    }

    private func markdown(from string: String) -> AttributedString {
        (try? AttributedString(markdown: string, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ??
        AttributedString(string)
    }

    private func label(for type: ContentType) -> String {
        switch type {
        case .article: return "ARTICLE"
        case .webPage: return "PAGE"
        case .newsletter: return "NEWSLETTER"
        case .tweet: return "TWEET"
        case .video: return "VIDEO"
        case .pdf: return "PDF"
        case .podcast: return "PODCAST"
        }
    }

    private var tintColor: Color? {
        switch ContentType(rawValue: item.contentType ?? "") {
        case .tweet: return BrettColors.cerulean
        case .video: return BrettColors.purple400
        case .pdf: return BrettColors.error
        default: return nil
        }
    }
}
