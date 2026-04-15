import SwiftUI

/// Markdown renderer that supports the syntax our server emits and the
/// briefing/article reader expect:
///   - Headings (#, ##, ###, ####)
///   - Ordered and unordered lists (1., -, *)
///   - Inline: **bold**, *italic*, _italic_, `code`, [links](url)
///   - Paragraphs separated by a blank line
///
/// SwiftUI's native `AttributedString(markdown:)` is inline-only by design;
/// we wrap it in a lightweight block-level walker so paragraphs, headings,
/// and list items each render with their own typography.
///
/// Links are intercepted via `environment(\.openURL)` in the caller — pass a
/// handler through `onOpenLink` and it fires before the system default.
struct MarkdownRenderer: View {
    /// Raw Markdown source (the server's payload).
    let source: String

    /// Style preset — briefing is tighter; article is looser and slightly
    /// larger.
    var style: Style = .briefing

    /// Invoked when the user taps a link. If provided, the default system
    /// open is suppressed and the caller decides how to route (usually
    /// presenting `SafariView`).
    var onOpenLink: ((URL) -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: style.blockSpacing) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                render(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.openURL, OpenURLAction { url in
            if let handler = onOpenLink {
                handler(url)
                return .handled
            }
            return .systemAction
        })
    }

    // MARK: - Rendering

    @ViewBuilder
    private func render(_ block: MarkdownBlock) -> some View {
        switch block {
        case .heading(level: let level, text: let text):
            heading(level: level, text: text)

        case .paragraph(let text):
            Text(inline(text))
                .font(style.bodyFont)
                .foregroundStyle(style.bodyColor)
                .lineSpacing(style.lineSpacing)
                .fixedSize(horizontal: false, vertical: true)

        case .bulletList(let items):
            VStack(alignment: .leading, spacing: style.itemSpacing) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, text in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\u{2022}")
                            .font(style.bodyFont)
                            .foregroundStyle(BrettColors.gold.opacity(0.80))
                        Text(inline(text))
                            .font(style.bodyFont)
                            .foregroundStyle(style.bodyColor)
                            .lineSpacing(style.lineSpacing)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

        case .numberedList(let items):
            VStack(alignment: .leading, spacing: style.itemSpacing) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, text in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\(index + 1).")
                            .font(style.bodyFont.monospacedDigit())
                            .foregroundStyle(Color.white.opacity(0.50))
                        Text(inline(text))
                            .font(style.bodyFont)
                            .foregroundStyle(style.bodyColor)
                            .lineSpacing(style.lineSpacing)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func heading(level: Int, text: String) -> some View {
        switch level {
        case 1:
            Text(inline(text))
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(BrettColors.textHeading)
                .fixedSize(horizontal: false, vertical: true)
        case 2:
            // H2 renders as a section label in briefing style so the
            // "Top 3", "Meetings", etc. headings land as proper visual
            // breaks rather than body-sized text.
            Text(text.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(2.4)
                .foregroundStyle(Color.white.opacity(0.40))
                .padding(.top, style.sectionTopPadding)
        case 3:
            Text(inline(text))
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(BrettColors.textCardTitle)
                .padding(.top, 4)
                .fixedSize(horizontal: false, vertical: true)
        default:
            Text(inline(text))
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(BrettColors.textCardTitle)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func inline(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        if let parsed = try? AttributedString(markdown: text, options: options) {
            return parsed
        }
        return AttributedString(text)
    }

    // MARK: - Block parsing

    /// Public for testing so we can pin the parser's block segmentation.
    var blocks: [MarkdownBlock] {
        MarkdownBlock.parse(source)
    }
}

// MARK: - Style

extension MarkdownRenderer {
    struct Style {
        var bodyFont: Font
        var bodyColor: Color
        var lineSpacing: CGFloat
        var blockSpacing: CGFloat
        var itemSpacing: CGFloat
        var sectionTopPadding: CGFloat

        /// Daily Briefing card — compact, body text at 14pt.
        static let briefing = Style(
            bodyFont: .system(size: 14),
            bodyColor: BrettColors.textBody,
            lineSpacing: 4,
            blockSpacing: 10,
            itemSpacing: 6,
            sectionTopPadding: 10
        )

        /// Article reader — more breathing room, slightly larger type.
        static let article = Style(
            bodyFont: .system(size: 16),
            bodyColor: Color.white.opacity(0.88),
            lineSpacing: 6,
            blockSpacing: 14,
            itemSpacing: 8,
            sectionTopPadding: 12
        )
    }
}

// MARK: - Block model

/// A block-level chunk of Markdown. Exposed as `internal` so tests can
/// compare the parser output without going through SwiftUI rendering.
enum MarkdownBlock: Equatable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case bulletList([String])
    case numberedList([String])

    /// Segment `source` into blocks. Splits on blank lines, then classifies
    /// each chunk. List items within a chunk are grouped.
    static func parse(_ source: String) -> [MarkdownBlock] {
        // Normalise Windows line endings and trim.
        let normalised = source.replacingOccurrences(of: "\r\n", with: "\n")
        let lines = normalised.components(separatedBy: "\n")

        var blocks: [MarkdownBlock] = []
        var bulletBuffer: [String] = []
        var numberBuffer: [String] = []
        var paragraphBuffer: [String] = []

        func flushParagraph() {
            guard !paragraphBuffer.isEmpty else { return }
            let text = paragraphBuffer.joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)
            if !text.isEmpty {
                blocks.append(.paragraph(text))
            }
            paragraphBuffer.removeAll()
        }
        func flushBullets() {
            if !bulletBuffer.isEmpty {
                blocks.append(.bulletList(bulletBuffer))
                bulletBuffer.removeAll()
            }
        }
        func flushNumbers() {
            if !numberBuffer.isEmpty {
                blocks.append(.numberedList(numberBuffer))
                numberBuffer.removeAll()
            }
        }
        func flushAll() {
            flushParagraph()
            flushBullets()
            flushNumbers()
        }

        for rawLine in lines {
            let line = rawLine.trimmingCharacters(in: .whitespaces)

            if line.isEmpty {
                flushAll()
                continue
            }

            // Headings (1–4 #s; more #s fall through to paragraph).
            if let (level, text) = headingPrefix(line), level <= 4 {
                flushAll()
                blocks.append(.heading(level: level, text: text))
                continue
            }

            // Bulleted list: -, *, •
            if let body = bulletPrefix(line) {
                flushParagraph()
                flushNumbers()
                bulletBuffer.append(body)
                continue
            }

            // Numbered list: 1.  2)  10.
            if let body = numberedPrefix(line) {
                flushParagraph()
                flushBullets()
                numberBuffer.append(body)
                continue
            }

            // Anything else is paragraph text — flush list buffers so lists
            // don't silently absorb follow-on prose.
            flushBullets()
            flushNumbers()
            paragraphBuffer.append(line)
        }

        flushAll()
        return blocks
    }

    private static func headingPrefix(_ line: String) -> (Int, String)? {
        var level = 0
        for ch in line {
            if ch == "#" {
                level += 1
                if level > 6 { return nil }
            } else {
                break
            }
        }
        guard level >= 1 else { return nil }
        let rest = line.dropFirst(level)
        // Require a space after the #s so we don't match "#hashtag" style.
        guard let first = rest.first, first == " " else { return nil }
        return (level, rest.trimmingCharacters(in: .whitespaces))
    }

    private static func bulletPrefix(_ line: String) -> String? {
        for marker in ["- ", "* ", "\u{2022} "] {
            if line.hasPrefix(marker) {
                return String(line.dropFirst(marker.count))
            }
        }
        return nil
    }

    /// Accepts `1.` or `1)` followed by a space, through any number length.
    private static func numberedPrefix(_ line: String) -> String? {
        var index = line.startIndex
        var digits = 0
        while index < line.endIndex, line[index].isNumber {
            digits += 1
            index = line.index(after: index)
        }
        guard digits > 0, index < line.endIndex else { return nil }
        let punct = line[index]
        guard punct == "." || punct == ")" else { return nil }
        let afterPunct = line.index(after: index)
        guard afterPunct < line.endIndex, line[afterPunct] == " " else { return nil }
        return String(line[line.index(after: afterPunct)...])
    }
}
