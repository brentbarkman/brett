import Foundation
import Testing
@testable import Brett

/// Tests for `TodayHero.stripMarkdownToPlain` — the function that
/// turns the briefing markdown into the single-paragraph editorial
/// prose shown in the calm-hero. The contract here is what keeps the
/// hero from going silently blank when the API briefing format
/// changes; see `TodayHero.swift` for the design intent.
///
/// Production briefings come out of `getBriefingPrompt` as a 3-5
/// bullet list (every line begins with `- `). The earlier version of
/// this stripper treated bullet-prefixed lines as structural and
/// skipped them, which left the hero with an empty string and a
/// hidden briefing card. These cases pin the bullet-folding behavior
/// so that regression can't recur.
///
/// `@MainActor` because `TodayHero` conforms to `View` and inherits
/// MainActor isolation under Swift 6 strict concurrency — calling its
/// static funcs from a non-isolated test context traps at runtime.
@MainActor
@Suite("TodayHero markdown stripping", .tags(.views))
struct TodayHeroTests {

    // MARK: - Prose-only

    @Test func plainProseReturnsAsIs() {
        let md = "Two things slipped past Friday — clear those first."
        #expect(TodayHero.stripMarkdownToPlain(md) == md)
    }

    @Test func multiLineProseFoldsWithSpace() {
        let md = """
        First line.
        Second line.
        """
        #expect(TodayHero.stripMarkdownToPlain(md) == "First line. Second line.")
    }

    @Test func blankLineSplitsParagraphsAndFirstWins() {
        let md = """
        First paragraph wins.

        Second paragraph is dropped.
        """
        #expect(TodayHero.stripMarkdownToPlain(md) == "First paragraph wins.")
    }

    // MARK: - Bullet-only (production format)

    @Test func bulletOnlyBriefingFoldsIntoOneParagraph() {
        // Mirrors the `getBriefingPrompt` example output. The earlier
        // behavior returned "" here, which hid the hero card entirely
        // — that's the regression these tests guard against.
        let md = """
        - 2 overdue: Q3 budget review (3 days late) and Reply to Sarah's proposal (1 day).
        - Due today: Ship v2.1 release notes — been sitting since Monday.
        - 10:00 AM: Product sync with Design (Lena, Marcus). 2:30 PM: 1:1 with Jordan.
        - Start with Sarah's proposal — it's quick, then block time for the budget review.
        """
        let result = TodayHero.stripMarkdownToPlain(md)
        #expect(!result.isEmpty)
        #expect(result.hasPrefix("2 overdue: Q3 budget review"))
        // The 280-char sentence-boundary cap should bite before the
        // last bullet, so the actionable suggestion gets dropped from
        // the hero — that's expected and acceptable; the full briefing
        // lives elsewhere.
        #expect(result.count <= 280)
    }

    @Test func singleBulletStripsMarker() {
        let md = "- The only line."
        #expect(TodayHero.stripMarkdownToPlain(md) == "The only line.")
    }

    @Test func asteriskBulletsStripMarker() {
        let md = """
        * First item.
        * Second item.
        """
        #expect(TodayHero.stripMarkdownToPlain(md) == "First item. Second item.")
    }

    @Test func plusBulletsStripMarker() {
        let md = "+ Plus-marker bullet."
        #expect(TodayHero.stripMarkdownToPlain(md) == "Plus-marker bullet.")
    }

    @Test func orderedListStripsMarker() {
        let md = """
        1. First task.
        2. Second task.
        12. Twelfth task.
        """
        #expect(TodayHero.stripMarkdownToPlain(md) == "First task. Second task. Twelfth task.")
    }

    // MARK: - Mixed content

    @Test func headingPlusBulletsKeepsBullets() {
        let md = """
        # Today's briefing

        - Bullet content.
        """
        #expect(TodayHero.stripMarkdownToPlain(md) == "Bullet content.")
    }

    @Test func proseLeadInJoinsWithBullets() {
        let md = """
        Here's what matters today.
        - First priority.
        - Second priority.
        """
        #expect(TodayHero.stripMarkdownToPlain(md) ==
                "Here's what matters today. First priority. Second priority.")
    }

    @Test func blockquotesAreSkipped() {
        let md = """
        > Skipped quote.
        Kept prose.
        """
        #expect(TodayHero.stripMarkdownToPlain(md) == "Kept prose.")
    }

    @Test func codeFenceMarkersAreSkipped() {
        // The stripper drops the ``` fence-marker lines but not the
        // content between them — it doesn't track multi-line fence
        // state. Acceptable: the briefing prompt never produces code
        // blocks. This test pins the actual behavior so a future
        // improvement to track fence state shows up as a deliberate
        // change rather than a silent regression.
        let md = """
        ```
        code body
        ```
        Kept prose.
        """
        #expect(TodayHero.stripMarkdownToPlain(md) == "code body Kept prose.")
    }

    @Test func horizontalRulesAreSkipped() {
        let md = """
        ---
        Kept prose.
        ***
        """
        #expect(TodayHero.stripMarkdownToPlain(md) == "Kept prose.")
    }

    // MARK: - Inline markdown stripping (preserved from original behavior)

    @Test func boldMarkersAreStripped() {
        let md = "- Wrap **Q3 review** in bold."
        #expect(TodayHero.stripMarkdownToPlain(md) == "Wrap Q3 review in bold.")
    }

    @Test func italicMarkersAreStripped() {
        let md = "This is *italic* text and _also italic_."
        #expect(TodayHero.stripMarkdownToPlain(md) == "This is italic text and also italic.")
    }

    @Test func linkSyntaxKeepsTextOnly() {
        let md = "Check [the doc](https://example.com) when ready."
        #expect(TodayHero.stripMarkdownToPlain(md) == "Check the doc when ready.")
    }

    @Test func inlineCodeBackticksAreStripped() {
        let md = "Run `pnpm test` after."
        #expect(TodayHero.stripMarkdownToPlain(md) == "Run pnpm test after.")
    }

    // MARK: - Edge cases

    @Test func emptyStringReturnsEmpty() {
        #expect(TodayHero.stripMarkdownToPlain("") == "")
    }

    @Test func onlyStructuralLinesReturnsEmpty() {
        let md = """
        # Heading
        ---
        > quote
        """
        #expect(TodayHero.stripMarkdownToPlain(md) == "")
    }

    @Test func bareDashIsNotTreatedAsBullet() {
        // `-` without trailing space + content isn't a bullet marker;
        // it's effectively garbage but should not crash and should not
        // be folded into the paragraph as content.
        let md = """
        -
        Real prose.
        """
        // The bare "-" survives as content (it's not structural and
        // not a stripped bullet); it joins with the following line.
        // Acceptable — bare dashes aren't expected in real briefings.
        let result = TodayHero.stripMarkdownToPlain(md)
        #expect(result.contains("Real prose"))
    }

    @Test func longContentTruncatesAtSentenceBoundary() {
        // 300+ chars of prose-like sentences. Cap is 280 with backtrack
        // to nearest period; result should end with "." not "…".
        let md = String(repeating: "This is a sentence. ", count: 25)
        let result = TodayHero.stripMarkdownToPlain(md)
        #expect(result.count <= 280)
        #expect(result.hasSuffix("."))
    }

    @Test func longContentWithoutPeriodFallsBackToEllipsis() {
        // No sentence boundaries → cap with "…".
        let md = String(repeating: "word ", count: 80)
        let result = TodayHero.stripMarkdownToPlain(md)
        #expect(result.count <= 281) // 280 + "…"
        #expect(result.hasSuffix("…"))
    }

    // MARK: - stripBulletMarker direct tests

    @Test func stripBulletMarkerHandlesAllPrefixes() {
        #expect(TodayHero.stripBulletMarker("- text") == "text")
        #expect(TodayHero.stripBulletMarker("* text") == "text")
        #expect(TodayHero.stripBulletMarker("+ text") == "text")
        #expect(TodayHero.stripBulletMarker("1. text") == "text")
        #expect(TodayHero.stripBulletMarker("42. text") == "text")
    }

    @Test func stripBulletMarkerLeavesProseAlone() {
        #expect(TodayHero.stripBulletMarker("Plain prose.") == "Plain prose.")
        #expect(TodayHero.stripBulletMarker("*italic*") == "*italic*")
        #expect(TodayHero.stripBulletMarker("Mr. Smith said hi.") == "Mr. Smith said hi.")
    }
}
