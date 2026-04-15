import Foundation

/// Lightweight natural-language parser for the omnibar. Pure Foundation,
/// no third-party NLP. Extracts list tags (`#name`), natural-language
/// dates/times, and categorizes the input as a task / event / question.
///
/// Order of operations matters: list tags are stripped first, then dates
/// via regex + `NSDataDetector`, and finally the remaining text is
/// classified.
enum SmartParser {

    // MARK: - Types

    struct ParseContext {
        /// 0 = Inbox, 1 = Today, 2 = Calendar. Matches `MainContainer`.
        let currentPage: Int
        let lists: [ListRef]
        let now: Date
        let calendar: Calendar

        init(
            currentPage: Int,
            lists: [ListRef],
            now: Date = Date(),
            calendar: Calendar = .current
        ) {
            self.currentPage = currentPage
            self.lists = lists
            self.now = now
            self.calendar = calendar
        }
    }

    /// Minimal shape the parser needs from whatever list model the caller has.
    struct ListRef {
        let id: String
        let name: String
    }

    enum InputKind {
        case task
        case event
        case question
    }

    enum Reminder: String {
        case morningOf = "morning_of"
        case oneHourBefore = "1_hour_before"
        case dayBefore = "day_before"
    }

    struct ParsedInput: Equatable {
        let title: String
        let dueDate: Date?
        /// True if the parsed due date has a meaningful time component (not
        /// just midnight). Used to pick the right reminder default.
        let hasExplicitTime: Bool
        let reminder: Reminder?
        let listId: String?
        let kind: InputKind
    }

    // MARK: - Entry point

    static func parse(_ input: String, context: ParseContext) -> ParsedInput {
        var working = input.trimmingCharacters(in: .whitespacesAndNewlines)

        // 1. List tag
        let (afterList, listId) = extractListTag(from: working, lists: context.lists)
        working = afterList

        // 2. Natural-language dates + times. Dates are extracted (removed
        //    from the title) as we find them.
        let (afterDate, dueDate, hasExplicitTime) = extractDate(from: working, context: context)
        working = afterDate

        // 3. Clean up the title — collapse whitespace, strip trailing
        //    punctuation left by the date extractor.
        let cleanedTitle = normalizeTitle(working)

        // 4. Classify kind. Question detection runs against the ORIGINAL
        //    input so trailing `?` isn't lost to date cleanup.
        let kind = classifyKind(
            originalInput: input.trimmingCharacters(in: .whitespacesAndNewlines),
            currentPage: context.currentPage
        )

        // 5. Pick a reminder default. Only set one if we actually have a
        //    due date — otherwise there's nothing to remind about.
        let reminder: Reminder? = {
            guard dueDate != nil else { return nil }
            return hasExplicitTime ? .oneHourBefore : .morningOf
        }()

        return ParsedInput(
            title: cleanedTitle,
            dueDate: dueDate,
            hasExplicitTime: hasExplicitTime,
            reminder: reminder,
            listId: listId,
            kind: kind
        )
    }

    // MARK: - List tag

    /// Finds the first `#<token>` in the input and tries to resolve it to a
    /// known list by case-insensitive prefix or substring match. Returns the
    /// input with the matched token stripped plus the resolved list id.
    ///
    /// A `#token` that doesn't match any list is left in place so the user
    /// sees their original text back.
    private static func extractListTag(
        from input: String,
        lists: [ListRef]
    ) -> (String, String?) {
        // Match `#` followed by word chars (letters, digits, underscore, dash).
        let regex = try? NSRegularExpression(pattern: "#([\\w-]+)", options: [])
        guard let regex else { return (input, nil) }

        let ns = input as NSString
        let matches = regex.matches(in: input, options: [], range: NSRange(location: 0, length: ns.length))
        for match in matches {
            guard match.numberOfRanges >= 2 else { continue }
            let tokenRange = match.range(at: 1)
            let token = ns.substring(with: tokenRange).lowercased()
            if let list = bestListMatch(for: token, in: lists) {
                let fullRange = match.range(at: 0)
                let stripped = ns.replacingCharacters(in: fullRange, with: "")
                return (stripped, list.id)
            }
        }
        return (input, nil)
    }

    private static func bestListMatch(for token: String, in lists: [ListRef]) -> ListRef? {
        let lower = token.lowercased()
        // Exact match first.
        if let exact = lists.first(where: { $0.name.lowercased() == lower }) {
            return exact
        }
        // Prefix match (e.g. `#groc` → `groceries`).
        if let prefix = lists.first(where: { $0.name.lowercased().hasPrefix(lower) }) {
            return prefix
        }
        // Fallback: substring.
        if let sub = lists.first(where: { $0.name.lowercased().contains(lower) }) {
            return sub
        }
        return nil
    }

    // MARK: - Date / time

    /// Returns the input with any recognized date/time phrases removed,
    /// the computed due date, and whether a time component was explicit.
    private static func extractDate(
        from input: String,
        context: ParseContext
    ) -> (String, Date?, Bool) {
        var working = input

        // Pass 1 — word-based relative dates. These are more reliable than
        // NSDataDetector for "tomorrow", "next monday", etc.
        var dayAnchor: Date? = nil
        if let hit = matchRelativeDay(in: working, context: context) {
            dayAnchor = hit.date
            working = hit.remainder
        }

        // Pass 2 — time component ("at 5pm", "at noon", "at 3:30", "at 15:00").
        var timeHit: (hour: Int, minute: Int, remainder: String)? = nil
        if let hit = matchTime(in: working) {
            timeHit = hit
            working = hit.remainder
        }

        // Pass 3 — "in 3 days", "in an hour" (relative duration).
        if dayAnchor == nil, let hit = matchRelativeDuration(in: working, context: context) {
            dayAnchor = hit.date
            working = hit.remainder
        }

        // Pass 4 — NSDataDetector catches absolute dates we haven't handled
        // ("March 15", "Dec 3 at 2pm", "2026-05-01"). We only let the
        // detector run if nothing else matched, so we don't fight with the
        // regex extractors on simple phrases.
        if dayAnchor == nil && timeHit == nil {
            if let hit = matchWithDataDetector(in: working, context: context) {
                return (hit.remainder, hit.date, hit.hasTime)
            }
        }

        // Compose the final date.
        let composed = composeDate(day: dayAnchor, time: timeHit, context: context)
        return (working, composed.date, composed.hasTime)
    }

    // MARK: - Relative day words

    private struct DateHit {
        let date: Date
        let remainder: String
    }

    private static func matchRelativeDay(
        in input: String,
        context: ParseContext
    ) -> DateHit? {
        let cal = context.calendar
        let today = cal.startOfDay(for: context.now)

        struct Candidate {
            let pattern: String
            let offsetDays: Int?
            let weekday: Int?  // Calendar weekday (1=Sun ... 7=Sat)
            let nextWeek: Bool
        }

        var candidates: [Candidate] = [
            Candidate(pattern: "\\btomorrow\\b", offsetDays: 1, weekday: nil, nextWeek: false),
            Candidate(pattern: "\\btoday\\b", offsetDays: 0, weekday: nil, nextWeek: false),
            Candidate(pattern: "\\btonight\\b", offsetDays: 0, weekday: nil, nextWeek: false),
            Candidate(pattern: "\\byesterday\\b", offsetDays: -1, weekday: nil, nextWeek: false),
            Candidate(pattern: "\\bnext week\\b", offsetDays: 7, weekday: nil, nextWeek: false),
        ]

        // Weekday forms, longest first so "next monday" matches before "monday".
        let weekdays: [(String, Int)] = [
            ("sunday", 1), ("monday", 2), ("tuesday", 3), ("wednesday", 4),
            ("thursday", 5), ("friday", 6), ("saturday", 7),
        ]
        for (name, wd) in weekdays {
            candidates.append(Candidate(pattern: "\\bnext \(name)\\b", offsetDays: nil, weekday: wd, nextWeek: true))
        }
        for (name, wd) in weekdays {
            candidates.append(Candidate(pattern: "\\b\(name)\\b", offsetDays: nil, weekday: wd, nextWeek: false))
        }

        for candidate in candidates {
            guard let regex = try? NSRegularExpression(pattern: candidate.pattern, options: [.caseInsensitive]) else { continue }
            let ns = input as NSString
            let range = NSRange(location: 0, length: ns.length)
            guard let match = regex.firstMatch(in: input, options: [], range: range) else { continue }

            let date: Date?
            if let offset = candidate.offsetDays {
                date = cal.date(byAdding: .day, value: offset, to: today)
            } else if let weekday = candidate.weekday {
                date = nextOccurrence(of: weekday, from: today, forceNextWeek: candidate.nextWeek, calendar: cal)
            } else {
                date = nil
            }
            guard let resolved = date else { continue }
            let remainder = ns.replacingCharacters(in: match.range, with: " ")
            return DateHit(date: resolved, remainder: remainder)
        }
        return nil
    }

    /// Returns the next calendar day matching `weekday`. If `forceNextWeek`
    /// is true the match is pushed at least 7 days into the future so
    /// "next friday" on a Wednesday doesn't return this Friday.
    private static func nextOccurrence(
        of weekday: Int,
        from anchor: Date,
        forceNextWeek: Bool,
        calendar: Calendar
    ) -> Date? {
        let anchorWeekday = calendar.component(.weekday, from: anchor)
        var diff = weekday - anchorWeekday
        if diff <= 0 { diff += 7 }
        if forceNextWeek && diff < 7 { diff += 7 }
        return calendar.date(byAdding: .day, value: diff, to: anchor)
    }

    // MARK: - Relative duration ("in 3 days", "in an hour")

    private static func matchRelativeDuration(
        in input: String,
        context: ParseContext
    ) -> DateHit? {
        // Day/week durations → start-of-day; hour/minute durations → preserve time.
        let patterns: [(String, (NSTextCheckingResult, NSString) -> Date?)] = [
            // "in 3 days" / "in 1 day" — day precision, anchor to start-of-day.
            (
                "\\bin\\s+(\\d+)\\s+days?\\b",
                { match, ns in
                    guard match.numberOfRanges >= 2 else { return nil }
                    let n = Int(ns.substring(with: match.range(at: 1))) ?? 0
                    let future = context.calendar.date(byAdding: .day, value: n, to: context.now) ?? context.now
                    return context.calendar.startOfDay(for: future)
                }
            ),
            // "in an hour" / "in 1 hour" — minute precision preserved.
            (
                "\\bin\\s+(?:an|1|a)\\s+hours?\\b",
                { _, _ in
                    context.calendar.date(byAdding: .hour, value: 1, to: context.now)
                }
            ),
            // "in 2 hours"
            (
                "\\bin\\s+(\\d+)\\s+hours?\\b",
                { match, ns in
                    guard match.numberOfRanges >= 2 else { return nil }
                    let n = Int(ns.substring(with: match.range(at: 1))) ?? 0
                    return context.calendar.date(byAdding: .hour, value: n, to: context.now)
                }
            ),
            // "in 30 minutes" — minute precision preserved.
            (
                "\\bin\\s+(\\d+)\\s+min(?:ute)?s?\\b",
                { match, ns in
                    guard match.numberOfRanges >= 2 else { return nil }
                    let n = Int(ns.substring(with: match.range(at: 1))) ?? 0
                    return context.calendar.date(byAdding: .minute, value: n, to: context.now)
                }
            ),
            // "in a week" — day precision, start-of-day.
            (
                "\\bin\\s+(?:a|1)\\s+weeks?\\b",
                { _, _ in
                    let future = context.calendar.date(byAdding: .day, value: 7, to: context.now) ?? context.now
                    return context.calendar.startOfDay(for: future)
                }
            ),
            // "in N weeks"
            (
                "\\bin\\s+(\\d+)\\s+weeks?\\b",
                { match, ns in
                    guard match.numberOfRanges >= 2 else { return nil }
                    let n = Int(ns.substring(with: match.range(at: 1))) ?? 0
                    let future = context.calendar.date(byAdding: .day, value: n * 7, to: context.now) ?? context.now
                    return context.calendar.startOfDay(for: future)
                }
            ),
        ]

        let ns = input as NSString
        let range = NSRange(location: 0, length: ns.length)
        for (pattern, builder) in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            guard let match = regex.firstMatch(in: input, options: [], range: range) else { continue }
            guard let date = builder(match, ns) else { continue }
            let remainder = ns.replacingCharacters(in: match.range, with: " ")
            return DateHit(date: date, remainder: remainder)
        }
        return nil
    }

    // MARK: - Time-of-day

    private static func matchTime(
        in input: String
    ) -> (hour: Int, minute: Int, remainder: String)? {
        // "at 5pm", "at 5:30pm", "at 17:00", "at noon", "at midnight".
        struct TimePattern {
            let regex: String
            let build: (NSTextCheckingResult, NSString) -> (Int, Int)?
        }

        let patterns: [TimePattern] = [
            // "at noon"
            TimePattern(
                regex: "\\bat\\s+noon\\b",
                build: { _, _ in (12, 0) }
            ),
            // "at midnight"
            TimePattern(
                regex: "\\bat\\s+midnight\\b",
                build: { _, _ in (0, 0) }
            ),
            // "at HH:MM(am|pm)?" — requires `at` to avoid colliding with
            // "5 apples" etc.
            TimePattern(
                regex: "\\bat\\s+(\\d{1,2}):(\\d{2})\\s*(am|pm|AM|PM)?\\b",
                build: { match, ns in
                    guard match.numberOfRanges >= 3 else { return nil }
                    var hour = Int(ns.substring(with: match.range(at: 1))) ?? 0
                    let minute = Int(ns.substring(with: match.range(at: 2))) ?? 0
                    let meridiemRange = match.range(at: 3)
                    let meridiem = meridiemRange.location != NSNotFound
                        ? ns.substring(with: meridiemRange).lowercased()
                        : ""
                    hour = normalizeHour(hour, meridiem: meridiem)
                    guard hour >= 0 && hour < 24 && minute >= 0 && minute < 60 else { return nil }
                    return (hour, minute)
                }
            ),
            // "at 5pm" / "at 5 pm"
            TimePattern(
                regex: "\\bat\\s+(\\d{1,2})\\s*(am|pm|AM|PM)\\b",
                build: { match, ns in
                    guard match.numberOfRanges >= 3 else { return nil }
                    var hour = Int(ns.substring(with: match.range(at: 1))) ?? 0
                    let meridiem = ns.substring(with: match.range(at: 2)).lowercased()
                    hour = normalizeHour(hour, meridiem: meridiem)
                    guard hour >= 0 && hour < 24 else { return nil }
                    return (hour, 0)
                }
            ),
            // Bare "at 17" (24-hour) — low priority; require 2 digits or
            // we'd misfire on "at 5" meaning 5am vs 5pm ambiguously. Keep
            // it off for now; users typing "at 5" usually want PM.
            TimePattern(
                regex: "\\bat\\s+(\\d{1,2})\\b",
                build: { match, ns in
                    guard match.numberOfRanges >= 2 else { return nil }
                    let hour = Int(ns.substring(with: match.range(at: 1))) ?? 0
                    guard hour >= 0 && hour < 24 else { return nil }
                    // Ambiguous — assume PM for 1-11, 24h for 13-23.
                    let resolved = (hour >= 1 && hour <= 11) ? hour + 12 : hour
                    return (resolved, 0)
                }
            ),
        ]

        let ns = input as NSString
        let range = NSRange(location: 0, length: ns.length)
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern.regex, options: [.caseInsensitive]) else { continue }
            guard let match = regex.firstMatch(in: input, options: [], range: range) else { continue }
            guard let (hour, minute) = pattern.build(match, ns) else { continue }
            let remainder = ns.replacingCharacters(in: match.range, with: " ")
            return (hour, minute, remainder)
        }
        return nil
    }

    private static func normalizeHour(_ hour: Int, meridiem: String) -> Int {
        switch meridiem {
        case "am":
            return hour == 12 ? 0 : hour
        case "pm":
            return hour == 12 ? 12 : hour + 12
        default:
            return hour
        }
    }

    // MARK: - NSDataDetector fallback

    private static func matchWithDataDetector(
        in input: String,
        context: ParseContext
    ) -> (date: Date, remainder: String, hasTime: Bool)? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue) else {
            return nil
        }
        let ns = input as NSString
        let range = NSRange(location: 0, length: ns.length)
        let matches = detector.matches(in: input, options: [], range: range)
        guard let match = matches.first, let date = match.date else { return nil }
        // Heuristic for `hasTime`: NSDataDetector gives us a specific
        // timestamp even when only a day was named; we check whether the
        // user's text contains any time-like tokens so the remainder logic
        // isn't tripped.
        let segment = ns.substring(with: match.range)
        let hasTime = segment.range(of: ":") != nil
            || segment.range(of: #"\d\s*(am|pm|AM|PM)"#, options: .regularExpression) != nil
            || segment.lowercased().contains("noon")
            || segment.lowercased().contains("midnight")
        let remainder = ns.replacingCharacters(in: match.range, with: " ")
        return (date, remainder, hasTime)
    }

    // MARK: - Compose day + time

    private static func composeDate(
        day: Date?,
        time: (hour: Int, minute: Int, remainder: String)?,
        context: ParseContext
    ) -> (date: Date?, hasTime: Bool) {
        let cal = context.calendar

        // Case: no day, no time — no date.
        if day == nil && time == nil {
            return (nil, false)
        }

        // Start from the day anchor (or today if only time is present).
        let anchorDay: Date = day ?? cal.startOfDay(for: context.now)

        // Time-only → bind to today, but if the requested time is in the
        // past push it to tomorrow. Makes "at 5pm" at 6pm mean tomorrow 5pm.
        if day == nil, let t = time {
            let todayAtTime = cal.date(
                bySettingHour: t.hour,
                minute: t.minute,
                second: 0,
                of: cal.startOfDay(for: context.now)
            ) ?? anchorDay
            if todayAtTime < context.now {
                let tomorrow = cal.date(byAdding: .day, value: 1, to: todayAtTime) ?? todayAtTime
                return (tomorrow, true)
            }
            return (todayAtTime, true)
        }

        // Day + time.
        if let t = time {
            let composed = cal.date(
                bySettingHour: t.hour,
                minute: t.minute,
                second: 0,
                of: anchorDay
            ) ?? anchorDay
            return (composed, true)
        }

        // Day only — but if the anchor already carries a specific time
        // (e.g. from `matchRelativeDuration` giving us `now + 20 minutes`),
        // preserve it rather than truncating to start-of-day.
        let components = cal.dateComponents([.hour, .minute], from: anchorDay)
        let hasExplicitTime = (components.hour ?? 0) != 0 || (components.minute ?? 0) != 0
        if hasExplicitTime {
            return (anchorDay, true)
        }
        let startOfDay = cal.startOfDay(for: anchorDay)
        return (startOfDay, false)
    }

    // MARK: - Classification

    private static func classifyKind(
        originalInput: String,
        currentPage: Int
    ) -> InputKind {
        let lower = originalInput.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        // Question: ends with `?` OR starts with a WH word.
        if lower.hasSuffix("?") {
            return .question
        }
        let whWords = ["what", "who", "why", "how", "when", "where"]
        for wh in whWords {
            if lower == wh || lower.hasPrefix("\(wh) ") || lower.hasPrefix("\(wh)'") {
                return .question
            }
        }
        if currentPage == 2 {
            return .event
        }
        return .task
    }

    // MARK: - Title cleanup

    private static func normalizeTitle(_ raw: String) -> String {
        var s = raw
        // Collapse runs of whitespace.
        while s.contains("  ") {
            s = s.replacingOccurrences(of: "  ", with: " ")
        }
        // Strip leading/trailing whitespace and punctuation left over from
        // extraction (e.g. "buy milk ," → "buy milk").
        let trimSet = CharacterSet.whitespacesAndNewlines.union(
            CharacterSet(charactersIn: ",;:")
        )
        s = s.trimmingCharacters(in: trimSet)
        // Also strip a trailing `?` we kept for question detection — the
        // title shouldn't carry it.
        if s.hasSuffix("?") {
            s = String(s.dropLast())
            s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return s
    }
}
