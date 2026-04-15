import Foundation
import SwiftUI
import Testing
@testable import Brett

/// Tests for `QueryHighlighter.attributed(text:query:)`.
///
/// Strategy: after building the `AttributedString`, we walk its runs and
/// inspect `foregroundColor`. Runs whose colour equals the highlight
/// colour are considered "matched". That lets us assert on which parts of
/// the text got painted without having to reach into SwiftUI's private
/// colour comparison surface.
@Suite("QueryHighlighter", .tags(.views))
struct QueryHighlighterTests {

    // MARK: - Token extraction

    @Test func tokensSplitsOnWhitespace() {
        let tokens = QueryHighlighter.tokens(from: "ship the newsletter")
        #expect(tokens == ["ship", "the", "newsletter"])
    }

    @Test func tokensTrimsAndDedupesCaseInsensitive() {
        let tokens = QueryHighlighter.tokens(from: "  Foo foo FOO bar  ")
        #expect(tokens == ["Foo", "bar"])
    }

    @Test func tokensIsEmptyForWhitespaceOnly() {
        #expect(QueryHighlighter.tokens(from: "   ").isEmpty)
        #expect(QueryHighlighter.tokens(from: "").isEmpty)
    }

    // MARK: - Highlighting

    @Test func highlightsSingleWordMatch() {
        let text = "Ship the newsletter"
        let attr = QueryHighlighter.attributed(
            text: text,
            query: "ship",
            highlightColor: .red
        )
        let matched = matchedSubstrings(in: attr, color: .red)
        #expect(matched == ["Ship"])
    }

    @Test func highlightIsCaseInsensitive() {
        let text = "Ship the Ship parts"
        let attr = QueryHighlighter.attributed(
            text: text,
            query: "SHIP",
            highlightColor: .red
        )
        let matched = matchedSubstrings(in: attr, color: .red)
        #expect(matched == ["Ship", "Ship"])
    }

    @Test func highlightsMultipleWordsIndependently() {
        let text = "Ship the newsletter draft"
        let attr = QueryHighlighter.attributed(
            text: text,
            query: "ship newsletter",
            highlightColor: .red
        )
        let matched = matchedSubstrings(in: attr, color: .red)
        #expect(matched.contains("Ship"))
        #expect(matched.contains("newsletter"))
    }

    @Test func emptyQueryReturnsUnchangedText() {
        let text = "Hello world"
        let attr = QueryHighlighter.attributed(
            text: text,
            query: "",
            highlightColor: .red
        )
        let matched = matchedSubstrings(in: attr, color: .red)
        #expect(matched.isEmpty)
        // The plain string should still round-trip.
        #expect(String(attr.characters) == text)
    }

    @Test func noMatchLeavesTextUnhighlighted() {
        let text = "Hello world"
        let attr = QueryHighlighter.attributed(
            text: text,
            query: "xyz",
            highlightColor: .red
        )
        let matched = matchedSubstrings(in: attr, color: .red)
        #expect(matched.isEmpty)
    }

    @Test func diacriticInsensitiveMatch() {
        let text = "Meet José next week"
        let attr = QueryHighlighter.attributed(
            text: text,
            query: "jose",
            highlightColor: .red
        )
        let matched = matchedSubstrings(in: attr, color: .red)
        #expect(matched == ["José"])
    }

    // MARK: - Helpers

    /// Walk the runs of an `AttributedString` and return the substrings
    /// whose `foregroundColor` attribute matches the given colour.
    private func matchedSubstrings(in attr: AttributedString, color: Color) -> [String] {
        var out: [String] = []
        for run in attr.runs {
            if let runColor = run.foregroundColor, runColor == color {
                let substring = String(attr[run.range].characters)
                out.append(substring)
            }
        }
        return out
    }
}
