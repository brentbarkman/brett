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

    /// Reactive read of the shared awakening opacity. The hero gets
    /// the slower of the two awakening fades (vs. content) so it
    /// blooms in after the workspace has landed — see `Awakening`
    /// in `MainContainer.swift`.
    @State private var awakening = AwakeningState.shared

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
                    .font(.system(size: 13, weight: .regular))
                    .tracking(0.52) // 0.04em at 13pt
                    .foregroundStyle(Color.white.opacity(0.75))
                    .modifier(HeroLegibilityShadow())
            }

            // Brief — only when present and not dismissed-for-today.
            // Always white with the dual-shadow legibility stack. The
            // top-edge BriefingCanopy gradient (see TodayPage) gives
            // white prose a uniform field to sit on regardless of the
            // wallpaper's upper composition; the previous adaptive-color
            // path was deleted in the May 2026 readability review when
            // we accepted that smarter sampling couldn't beat a single
            // ambient layer in front of the photo.
            if let brief = briefSummary {
                Text(brief)
                    .font(.system(size: 18, weight: .regular))
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
        // Hero rides the slower awakening fade. With the parent
        // TabView already at `awakening.contentOpacity`, the visible
        // alpha here is the product of the two: at t≈1.0s the
        // workspace is fully present and the hero is still ~70%
        // through its own fade — the staged effect the user asked
        // for ("things list quickly, hero slightly slower to draw
        // attention to it").
        .opacity(awakening.heroOpacity)
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

    /// Sub-line — month + day only ("MAY 6"). The mockup shows
    /// "MAY 4 · 9:41 AM" but we drop the time deliberately: the
    /// iOS status bar already carries the wall-clock at the top
    /// of every screen, so a second time display in the hero is
    /// redundant — and keeping a live clock here would force a
    /// minute-by-minute view re-render (battery cost) for no new
    /// information.
    private var dateSubtitle: String {
        date.formatted(.dateTime.month(.abbreviated).day())
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
    /// summary suitable for the hero. Headings, blockquotes, code
    /// fences, and horizontal rules are dropped (they don't read as
    /// prose). List bullet markers (`-`, `*`, `+`, `N.`) are stripped
    /// and the bullet TEXT is folded into the paragraph — the API's
    /// briefing prompt produces a bullet list, so without this step
    /// the hero renders nothing. Inline emphasis and link syntax are
    /// stripped, then the result is truncated at ~280 chars on the
    /// nearest sentence boundary.
    ///
    /// Public for testability — `TodayHeroTests` exercises the
    /// markdown-stripping cases directly without rendering SwiftUI.
    /// Lines we drop entirely (no readable prose equivalent): headings,
    /// blockquotes, code fences, horizontal rules.
    private static func isStructuralLine(_ trimmed: String) -> Bool {
        if trimmed.hasPrefix("#") { return true }                    // heading
        if trimmed.hasPrefix(">") { return true }                    // blockquote
        if trimmed.hasPrefix("```") { return true }                  // code fence
        if trimmed == "---" || trimmed == "***" { return true }      // horizontal rule
        return false
    }

    /// If `trimmed` starts with a list bullet marker (`- `, `* `, `+ `,
    /// or `N. `), return the text after the marker. Otherwise return
    /// `trimmed` unchanged. The trailing-space requirement is what
    /// keeps `*italic*` and `--hyphen` from being misread as bullets.
    static func stripBulletMarker(_ trimmed: String) -> String {
        // Unordered: `- text`, `* text`, `+ text`. Need at least
        // marker + space + one content character.
        if trimmed.count >= 3,
           let first = trimmed.first,
           first == "-" || first == "*" || first == "+" {
            let afterMarker = trimmed.index(after: trimmed.startIndex)
            if trimmed[afterMarker] == " " {
                return String(trimmed[trimmed.index(after: afterMarker)...])
            }
        }
        // Ordered: `1. text`, `12. text`. Leading digits, then `. `.
        if let dot = trimmed.firstIndex(of: "."),
           dot > trimmed.startIndex,
           trimmed[..<dot].allSatisfy({ $0.isNumber }) {
            let afterDot = trimmed.index(after: dot)
            if afterDot < trimmed.endIndex, trimmed[afterDot] == " " {
                return String(trimmed[trimmed.index(after: afterDot)...])
            }
        }
        return trimmed
    }

    static func stripMarkdownToPlain(_ md: String) -> String {
        // Walk the lines and pick the first content paragraph. Bullet
        // lines have their marker stripped so the text joins the
        // surrounding prose; consecutive non-empty lines fold together
        // with a single space (matches markdown soft-break semantics).
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
            let content = Self.stripBulletMarker(trimmed)
            if content.isEmpty { continue }
            if !current.isEmpty { current += " " }
            current += content
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
    /// Dual-shadow stack ("B" recipe from the May 2026 briefing-readability
    /// review): a tight 1pt outline to defend against single-pixel boundary
    /// fights, plus a wider soft drop for atmospheric pop. Applied
    /// unconditionally now that the briefing prose is always white — the
    /// previous `visible` opt-out existed to suppress the halo when prose
    /// flipped to dark text on a sampled-bright wallpaper, a path that no
    /// longer exists.
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
