import SwiftUI

/// Editorial hero for the Today page — the brand surface of the iOS app.
///
/// Calm-hero design (2026-05-04 spec): replaces the prior 28pt date
/// header + cerulean-tinted DailyBriefing card with a single typographic
/// composition that sits directly over the background photo. Three text
/// elements only: time-of-day greeting (38pt serif), date sub-line, and
/// the briefing prose.
///
/// The hero owns no chrome (no card, no border, no glass). It scrolls
/// with the rest of the page; the photo behind it stays put because
/// `BackgroundView` lives at the `MainContainer` z-stack root. As the
/// user scrolls, the hero rises off and the wash content underneath
/// covers more of the photo — reading as the photo "fading out."
///
/// Brief copy comes from `BriefingStore.briefing` (markdown). For the
/// hero we strip markdown to a single-paragraph plain summary so the
/// text reads as editorial prose, not a structured document. The full
/// markdown rendering is no longer surfaced on Today; if a richer
/// briefing surface returns later it'd live in its own destination
/// (e.g. a dedicated reader sheet) rather than re-cluttering the home
/// screen.
struct TodayHero: View {
    @Bindable var briefingStore: BriefingStore
    let date: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            // Greeting + date sub-line. Per v18 mockup:
            //   .greeting { 38px serif, weight 500, letter-spacing -0.02em }
            //   .meta     { 11px UPPERCASE, white/0.75, letter-spacing 0.04em }
            // Was rendering the date as plain mixed-case 13pt — too
            // chatty next to the editorial greeting; the uppercase
            // tracked treatment reads as an editorial dateline.
            VStack(alignment: .leading, spacing: 8) {
                Text(greeting)
                    .font(.system(size: 38, weight: .medium, design: .serif))
                    .tracking(-0.76) // -0.02em at 38pt
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .modifier(HeroLegibilityShadow())

                Text(dateSubtitle.uppercased())
                    .font(.system(size: 11, weight: .regular))
                    .tracking(0.44) // 0.04em at 11pt
                    .foregroundStyle(Color.white.opacity(0.75))
                    .modifier(HeroLegibilityShadow())
            }

            // Brief — only when present and not dismissed-for-today.
            // 17pt full-white with the same legibility shadow as the
            // greeting. Kept to a single paragraph; longer briefings get
            // sentence-truncated so the hero stays scannable.
            if let brief = briefSummary {
                Text(brief)
                    .font(.system(size: 17, weight: .regular))
                    .foregroundStyle(.white)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
                    .modifier(HeroLegibilityShadow())
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        // No minHeight — let the hero size itself to its content. The
        // earlier 220pt floor was creating dead space below the brief
        // when the briefing was short, pushing the first card too far
        // down. The greeting + sub-line + brief naturally claim
        // editorial real estate on their own (~150pt for a 3-sentence
        // brief, ~50pt for greeting+sub when there's no brief). A
        // skeleton placeholder for the brief would be the right
        // long-term fix for the "fresh launch with no brief yet"
        // case rather than reserving fixed empty space.
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("today.hero")
    }

    // MARK: - Derived

    /// Greeting per v18 mockup — just the weekday name with a period
    /// ("Wednesday."). The previous "Tuesday morning"/"night" form
    /// was an early calm-hero exploration; the mockup landed on the
    /// quieter weekday-only treatment that reads as a dateline rather
    /// than a salutation.
    private var greeting: String {
        let weekday = date.formatted(.dateTime.weekday(.wide))
        return "\(weekday)."
    }

    /// Sub-line per v18 mockup `MAY 4 · 9:41 AM` — month + day +
    /// dot separator + time. Was "MAY 5" only; adding the time
    /// makes the dateline carry the moment-of-the-glance signal
    /// the mockup shows.
    private var dateSubtitle: String {
        let monthDay = date.formatted(.dateTime.month(.abbreviated).day())
        let time = date.formatted(.dateTime.hour().minute())
        return "\(monthDay) · \(time)"
    }

    private var briefSummary: String? {
        guard !briefingStore.isDismissedToday,
              let raw = briefingStore.briefing,
              !raw.isEmpty else { return nil }
        let plain = Self.stripMarkdownToPlain(raw)
        return plain.isEmpty ? nil : plain
    }

    // MARK: - Markdown → plain summary

    /// Collapse a markdown briefing into a single-paragraph plain
    /// summary suitable for the hero. Strips headings, list bullets
    /// (unordered + ordered), blockquote markers, code fences, inline
    /// emphasis, and link syntax; truncates at ~280 chars on the
    /// nearest sentence boundary.
    ///
    /// Public for testability — `TodayHeroTests` exercises the
    /// markdown-stripping cases directly without rendering SwiftUI.
    /// Lines we don't want concatenated into the hero prose: list
    /// bullets, ordered list items, blockquotes, code fences, headings,
    /// and horizontal rules. Anything else is treated as prose.
    private static func isStructuralLine(_ trimmed: String) -> Bool {
        if trimmed.hasPrefix("#") { return true }                    // heading
        if trimmed.hasPrefix("-") { return true }                    // unordered list
        if trimmed.hasPrefix("*") { return true }                    // unordered list / emphasis-only
        if trimmed.hasPrefix("+") { return true }                    // unordered list (alt)
        if trimmed.hasPrefix(">") { return true }                    // blockquote
        if trimmed.hasPrefix("```") { return true }                  // code fence
        if trimmed == "---" || trimmed == "***" { return true }      // horizontal rule
        // Ordered list — `1. text`, `12. text`. Match a leading run of
        // digits followed by `. ` (the markdown ordered-list marker).
        if let firstSpace = trimmed.firstIndex(of: " "),
           let dot = trimmed.firstIndex(of: "."),
           dot < firstSpace,
           trimmed[..<dot].allSatisfy({ $0.isNumber }) {
            return true
        }
        return false
    }

    static func stripMarkdownToPlain(_ md: String) -> String {
        // Walk the lines and pick the first prose paragraph (skip
        // headings + list bullets — we want the conversational opener).
        let lines = md.components(separatedBy: .newlines)
        var paragraphs: [String] = []
        var current = ""
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                if !current.isEmpty {
                    paragraphs.append(current)
                    current = ""
                }
                continue
            }
            if Self.isStructuralLine(trimmed) {
                continue
            }
            if !current.isEmpty { current += " " }
            current += trimmed
        }
        if !current.isEmpty { paragraphs.append(current) }
        guard let first = paragraphs.first(where: { !$0.isEmpty }) else { return "" }

        // Strip basic markdown.
        var plain = first
        // [text](url) → text
        plain = plain.replacingOccurrences(
            of: #"\[([^\]]+)\]\([^)]+\)"#,
            with: "$1",
            options: .regularExpression
        )
        // **bold** → bold
        plain = plain.replacingOccurrences(
            of: #"\*\*([^*]+)\*\*"#,
            with: "$1",
            options: .regularExpression
        )
        // *italic* / _italic_ → italic
        plain = plain.replacingOccurrences(
            of: #"\*([^*]+)\*"#,
            with: "$1",
            options: .regularExpression
        )
        plain = plain.replacingOccurrences(
            of: #"_([^_]+)_"#,
            with: "$1",
            options: .regularExpression
        )
        // `code` → code
        plain = plain.replacingOccurrences(of: "`", with: "")

        // Length cap at ~280 chars on a sentence boundary. Hero stays
        // scannable; nobody wants to read three paragraphs over a photo.
        let cap = 280
        if plain.count > cap {
            let cutoff = plain.index(plain.startIndex, offsetBy: cap)
            let head = String(plain[..<cutoff])
            if let lastPeriod = head.lastIndex(of: ".") {
                return String(head[..<head.index(after: lastPeriod)])
            }
            return head + "…"
        }
        return plain
    }
}

/// Layered shadow to keep hero text legible against any photo. Tight 1pt
/// outline + a soft 8pt halo — same trick the v18 mockup uses. Composed
/// as a modifier so each text element in the hero applies it identically
/// without per-element duplication.
private struct HeroLegibilityShadow: ViewModifier {
    func body(content: Content) -> some View {
        content
            .shadow(color: Color.black.opacity(0.40), radius: 1, x: 0, y: 0)
            .shadow(color: Color.black.opacity(0.30), radius: 8, x: 0, y: 2)
    }
}

#if DEBUG
@MainActor
private struct TodayHeroPreview: View {
    let store: BriefingStore

    init() {
        let store = BriefingStore()
        store.injectForTesting(briefing: "Two things slipped past Friday — clear those first. Q2 board prep is your highest-leverage piece today. The afternoon is heavy.")
        self.store = store
    }

    var body: some View {
        ZStack {
            // Stand in for BackgroundView's photo. Real preview in the
            // app uses the bundled wallpaper.
            LinearGradient(
                colors: [Color(red: 0.18, green: 0.22, blue: 0.28), Color(red: 0.08, green: 0.06, blue: 0.05)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 0) {
                TodayHero(briefingStore: store, date: Date())
                Spacer()
            }
        }
        .preferredColorScheme(.dark)
    }
}

#Preview { TodayHeroPreview() }
#endif
