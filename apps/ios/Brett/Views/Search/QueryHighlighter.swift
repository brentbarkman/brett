import Foundation
import SwiftUI

/// Utility for highlighting query terms inside search titles + snippets.
///
/// Produces an `AttributedString` with matching query words painted in
/// the highlight colour (`BrettColors.gold` by default). Matching is
/// case-insensitive and diacritic-insensitive so "Jose" matches "José".
///
/// Word-based tokenisation — we split the query on whitespace so a
/// multi-word query like "ship the newsletter" highlights each word
/// independently. Duplicate tokens are deduplicated so a repeated word
/// doesn't cause redundant work.
enum QueryHighlighter {
    /// Build an `AttributedString` from `text` with every occurrence of any
    /// query token painted in `highlightColor`.
    ///
    /// - Parameters:
    ///   - text: The source string (title or snippet).
    ///   - query: The user's raw query. Empty / whitespace-only queries
    ///            return the text unchanged.
    ///   - highlightColor: Colour used for matched ranges. Defaults to gold.
    ///   - weight: Font weight applied to matched ranges. `.semibold` makes
    ///             matches legible without dominating the row. Pass `nil` to
    ///             leave weight unchanged.
    /// - Returns: An `AttributedString` ready to hand to `Text(_:)`.
    static func attributed(
        text: String,
        query: String,
        highlightColor: Color = BrettColors.gold,
        weight: Font.Weight? = .semibold
    ) -> AttributedString {
        var attr = AttributedString(text)
        let tokens = tokens(from: query)
        guard !tokens.isEmpty, !text.isEmpty else {
            return attr
        }

        for token in tokens {
            // `.caseInsensitive, .diacriticInsensitive` keeps the matcher
            // friendly for names and short queries. We stop each pass when
            // the range search fails rather than scanning the full text
            // again.
            var searchRange = attr.startIndex..<attr.endIndex
            while let foundRange = attr[searchRange].range(
                of: token,
                options: [.caseInsensitive, .diacriticInsensitive]
            ) {
                attr[foundRange].foregroundColor = highlightColor
                if let weight {
                    // SwiftUI lets us set a single `Font` attribute — we
                    // build the bold variant without knowing the caller's
                    // exact font by using the system font at the same size
                    // as the caller. That's approximate; rows always draw
                    // inline text so the visual effect is weight only.
                    attr[foundRange].font = .system(size: 13, weight: weight)
                }
                // Advance past this match to avoid infinite loops on
                // zero-length matches (shouldn't happen with non-empty
                // tokens, but cheap insurance).
                if foundRange.upperBound == searchRange.upperBound {
                    break
                }
                searchRange = foundRange.upperBound..<attr.endIndex
            }
        }
        return attr
    }

    /// Extract a deduped list of query tokens. Whitespace-splits and drops
    /// empty fragments. Exposed `internal` for tests.
    static func tokens(from query: String) -> [String] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }

        // Split on any unicode whitespace so "foo\tbar" works.
        let raw = trimmed.split(whereSeparator: { $0.isWhitespace })
        var seen = Set<String>()
        var out: [String] = []
        for piece in raw {
            let token = String(piece)
            // Dedupe case-insensitively so "Foo foo" becomes a single token.
            let key = token.lowercased()
            if !seen.contains(key) {
                seen.insert(key)
                out.append(token)
            }
        }
        return out
    }
}
