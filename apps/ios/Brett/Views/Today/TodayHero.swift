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
        VStack(alignment: .leading, spacing: 12) {
            // Greeting + date sub-line. Both carry the photo-shadow so
            // they're legible against any wallpaper in the manifest.
            VStack(alignment: .leading, spacing: 4) {
                Text(greeting)
                    .font(.system(size: 38, weight: .regular, design: .serif))
                    .foregroundStyle(.white)
                    .modifier(HeroLegibilityShadow())

                Text(dateSubtitle)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.70))
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
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        // A minimum height so the hero claims editorial real estate even
        // on slow networks where the brief hasn't landed yet (otherwise
        // a fresh-launch Today would briefly show a stubby hero with
        // just the greeting before the brief arrives).
        .frame(minHeight: 220, alignment: .topLeading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("today.hero")
    }

    // MARK: - Derived

    private var greeting: String {
        let weekday = date.formatted(.dateTime.weekday(.wide))
        return "\(weekday) \(partOfDay)"
    }

    private var partOfDay: String {
        let hour = Calendar.current.component(.hour, from: date)
        switch hour {
        case 5..<12: return "morning"
        case 12..<17: return "afternoon"
        case 17..<21: return "evening"
        default: return "night"
        }
    }

    private var dateSubtitle: String {
        date.formatted(.dateTime.month(.wide).day())
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
