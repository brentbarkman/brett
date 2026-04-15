import Foundation

/// Static label factories for VoiceOver. Centralising these strings keeps the
/// speech output consistent across every screen (Inbox, Today, Calendar,
/// Scouts) — if we ever need to shift a phrasing, it changes in one place.
///
/// All public functions are pure and take plain value types (Ints, Dates,
/// Strings) so they're trivially testable without a view graph or SwiftUI
/// environment.
enum AccessibilityLabels {
    // MARK: - Task (Item)

    /// Full VoiceOver label for a task row.
    ///
    /// Example: "Buy groceries, due tomorrow, in Shopping list. Completed."
    static func task(_ item: Item, listName: String? = nil, now: Date = Date()) -> String {
        var parts: [String] = [item.title]

        if let due = item.dueDate {
            parts.append("due " + relativeDayPhrase(for: due, now: now))
        }

        if let listName, !listName.isEmpty {
            parts.append("in \(listName) list")
        }

        if item.isCompleted {
            parts.append("Completed")
        }

        return parts.joined(separator: ", ")
    }

    // MARK: - Checkbox

    /// VoiceOver label for the circular checkbox beside a task title.
    /// Reads as the action the user will trigger, not the current state,
    /// because `.accessibilityAddTraits(.isButton)` already telegraphs
    /// "button".
    static func checkbox(_ item: Item) -> String {
        item.isCompleted
            ? "Mark \(item.title) incomplete"
            : "Mark \(item.title) complete"
    }

    /// Plain-string variant for contexts where we only have a title.
    static func checkbox(title: String, isCompleted: Bool) -> String {
        isCompleted
            ? "Mark \(title) incomplete"
            : "Mark \(title) complete"
    }

    // MARK: - Calendar event

    /// VoiceOver label for a calendar event row.
    ///
    /// Examples:
    ///  - "Team standup, 9:00 AM to 9:30 AM, with 3 attendees"
    ///  - "Offsite, all day"
    static func event(_ event: CalendarEvent) -> String {
        var parts: [String] = [event.title]

        if event.isAllDay {
            parts.append("all day")
        } else {
            let formatter = eventTimeFormatter
            let start = formatter.string(from: event.startTime)
            let end = formatter.string(from: event.endTime)
            parts.append("\(start) to \(end)")
        }

        // Exclude the current user (organizer) from the attendee count — a
        // 1-person meeting with only yourself reads oddly.
        let attendeeCount = event.attendees.count
        if attendeeCount == 1 {
            parts.append("with 1 attendee")
        } else if attendeeCount > 1 {
            parts.append("with \(attendeeCount) attendees")
        }

        if let location = event.location, !location.isEmpty {
            parts.append("at \(location)")
        }

        return parts.joined(separator: ", ")
    }

    // MARK: - Scout

    /// VoiceOver label for a scout row in the roster.
    ///
    /// Example: "Watching for AI news, 12 findings, active"
    static func scout(_ scout: Scout, findingsCount: Int = 0) -> String {
        var parts: [String] = ["Watching for \(scout.name)"]

        switch findingsCount {
        case 0:
            parts.append("no findings yet")
        case 1:
            parts.append("1 finding")
        default:
            parts.append("\(findingsCount) findings")
        }

        parts.append(scout.scoutStatus.rawValue)
        return parts.joined(separator: ", ")
    }

    // MARK: - Scout finding

    /// VoiceOver label for a single finding. Keeps the announcement short —
    /// full description is available via `.accessibilityValue` or hint.
    static func finding(_ finding: ScoutFinding) -> String {
        let typeLabel: String
        switch finding.findingType {
        case .insight: typeLabel = "Insight"
        case .article: typeLabel = "Article"
        case .task: typeLabel = "Task"
        }
        return "\(typeLabel), \(finding.title), from \(finding.sourceName)"
    }

    // MARK: - Other UI surfaces

    static func dailyBriefing() -> String {
        "Daily briefing. Double-tap to open today's plan."
    }

    static func voiceMode() -> String {
        "Voice mode. Double-tap to start dictating."
    }

    /// Example: "Today, page 2 of 3"
    static func pageIndicator(current: Int, total: Int, name: String) -> String {
        "\(name), page \(current) of \(total)"
    }

    // MARK: - Helpers

    /// Converts a due date into a phrase like "today", "tomorrow", "in 3 days",
    /// or a formatted date. Uses day-bucket arithmetic so "tomorrow at 11:59pm"
    /// still reads as "tomorrow", not "in 1 day".
    static func relativeDayPhrase(for date: Date, now: Date = Date()) -> String {
        let calendar = Calendar.current
        let startOfNow = calendar.startOfDay(for: now)
        let startOfDate = calendar.startOfDay(for: date)
        let days = calendar.dateComponents([.day], from: startOfNow, to: startOfDate).day ?? 0

        switch days {
        case 0: return "today"
        case 1: return "tomorrow"
        case -1: return "yesterday"
        case 2...6: return "in \(days) days"
        case -6 ... -2: return "\(-days) days ago"
        default:
            return dayFormatter.string(from: date)
        }
    }

    // MARK: - Formatters

    private static let eventTimeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f
    }()

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        return f
    }()
}
