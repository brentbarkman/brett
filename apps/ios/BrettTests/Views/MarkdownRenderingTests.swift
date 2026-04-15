import Foundation
import Testing
@testable import Brett

/// Tests for the block-level Markdown parser that powers the Daily Briefing
/// and article reader. The parser is the contract — the SwiftUI render
/// layer is a thin shell on top.
///
/// Pinning these cases means that when the briefing server starts emitting
/// a new shape (say, blockquotes or tables), we'll see the failure in the
/// parser rather than a silent "it just rendered as plain paragraphs".
@Suite("MarkdownRendering", .tags(.views))
struct MarkdownRenderingTests {

    // MARK: - Paragraphs

    @Test func singleParagraphYieldsOneBlock() {
        let blocks = MarkdownBlock.parse("Hello world.")
        #expect(blocks == [.paragraph("Hello world.")])
    }

    @Test func blankLineSplitsParagraphs() {
        let source = """
        First paragraph.

        Second paragraph.
        """
        let blocks = MarkdownBlock.parse(source)
        #expect(blocks == [
            .paragraph("First paragraph."),
            .paragraph("Second paragraph.")
        ])
    }

    @Test func singleNewlineJoinsAsParagraph() {
        // Markdown convention: soft breaks (single \n) do not start a new
        // block — they join into one paragraph with a space.
        let source = "Line one\nLine two"
        let blocks = MarkdownBlock.parse(source)
        #expect(blocks == [.paragraph("Line one Line two")])
    }

    // MARK: - Headings

    @Test func h1Heading() {
        let blocks = MarkdownBlock.parse("# Morning")
        #expect(blocks == [.heading(level: 1, text: "Morning")])
    }

    @Test func h2Heading() {
        let blocks = MarkdownBlock.parse("## Top 3")
        #expect(blocks == [.heading(level: 2, text: "Top 3")])
    }

    @Test func h3Heading() {
        let blocks = MarkdownBlock.parse("### Details")
        #expect(blocks == [.heading(level: 3, text: "Details")])
    }

    @Test func hashtagIsNotHeading() {
        // A "#hashtag" with no space after must NOT be parsed as a heading.
        let blocks = MarkdownBlock.parse("#hashtag not a heading")
        #expect(blocks == [.paragraph("#hashtag not a heading")])
    }

    @Test func fiveHashesStaysParagraph() {
        // Cap headings at h4; five #s falls through so the user sees the
        // content instead of disappearing into an unrendered heading.
        let blocks = MarkdownBlock.parse("##### too deep")
        if case .heading(let level, _) = blocks.first {
            #expect(level <= 4)
        } else {
            #expect(blocks.first == .paragraph("##### too deep"))
        }
    }

    // MARK: - Bullet lists

    @Test func dashBulletList() {
        let source = """
        - First
        - Second
        - Third
        """
        let blocks = MarkdownBlock.parse(source)
        #expect(blocks == [.bulletList(["First", "Second", "Third"])])
    }

    @Test func asteriskBulletList() {
        let source = """
        * One
        * Two
        """
        let blocks = MarkdownBlock.parse(source)
        #expect(blocks == [.bulletList(["One", "Two"])])
    }

    @Test func paragraphBreaksBulletList() {
        let source = """
        - First
        - Second

        Follow-up text.
        """
        let blocks = MarkdownBlock.parse(source)
        #expect(blocks == [
            .bulletList(["First", "Second"]),
            .paragraph("Follow-up text.")
        ])
    }

    // MARK: - Numbered lists

    @Test func numberedList() {
        let source = """
        1. First
        2. Second
        3. Third
        """
        let blocks = MarkdownBlock.parse(source)
        #expect(blocks == [.numberedList(["First", "Second", "Third"])])
    }

    @Test func numberedListWithTenItems() {
        // Multi-digit prefixes must still parse — regression on early versions
        // that only accepted a single digit.
        let source = """
        1. One
        10. Ten
        """
        let blocks = MarkdownBlock.parse(source)
        #expect(blocks == [.numberedList(["One", "Ten"])])
    }

    // MARK: - Inline syntax via AttributedString

    @Test func boldMarkdownParses() throws {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        let attr = try AttributedString(markdown: "This is **bold** text.", options: options)
        #expect(String(attr.characters) == "This is bold text.")
    }

    @Test func italicMarkdownParses() throws {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        let attr = try AttributedString(markdown: "This is _italic_ text.", options: options)
        #expect(String(attr.characters) == "This is italic text.")
    }

    @Test func inlineCodeMarkdownParses() throws {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        let attr = try AttributedString(markdown: "Run `npm install` first.", options: options)
        #expect(String(attr.characters) == "Run npm install first.")
    }

    @Test func linkMarkdownPreservesVisibleText() throws {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .inlineOnlyPreservingWhitespace
        )
        let attr = try AttributedString(
            markdown: "Check the [docs](https://example.com).",
            options: options
        )
        #expect(String(attr.characters) == "Check the docs.")
    }

    // MARK: - BriefingStore parsedBlocks integration

    @MainActor
    @Test func briefingStoreParsedBlocksHandlesEmptyBriefing() {
        let store = BriefingStore()
        #expect(store.parsedBlocks().isEmpty)
        #expect(store.parsedContent() == nil)
    }

    // MARK: - Real-world sample

    @Test func realisticBriefingStructure() {
        let source = """
        # Good morning, Brent

        You've got a light morning and a packed afternoon.

        ## Meetings

        - 10am — design review
        - 2pm — customer sync
        - 4pm — one-on-one

        ## Top 3

        1. Ship the release branch
        2. Reply to Sam about the contract
        3. Read the product memo
        """
        let blocks = MarkdownBlock.parse(source)
        #expect(blocks.count == 6)
        #expect(blocks[0] == .heading(level: 1, text: "Good morning, Brent"))
        #expect(blocks[2] == .heading(level: 2, text: "Meetings"))
        if case .bulletList(let bullets) = blocks[3] {
            #expect(bullets.count == 3)
        } else {
            Issue.record("Expected bulletList block at index 3")
        }
        if case .numberedList(let items) = blocks[5] {
            #expect(items.count == 3)
        } else {
            Issue.record("Expected numberedList block at index 5")
        }
    }
}
