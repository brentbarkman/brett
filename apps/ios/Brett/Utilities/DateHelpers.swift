import Foundation

enum DateHelpers {
    /// UTC calendar — matches `TodaySections.bucket()` and desktop's
    /// `computeUrgency` (`packages/business/src/index.ts`). Switching off
    /// `Calendar.current` makes this helper agree with the section
    /// bucketer rather than disagreeing once UTC and local fall on
    /// different days.
    private static let utcCalendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    static func computeUrgency(dueDate: Date?, isCompleted: Bool, now: Date = Date()) -> Urgency {
        if isCompleted { return .done }
        guard let dueDate else { return .later }

        let calendar = Self.utcCalendar
        let startOfToday = calendar.startOfDay(for: now)
        let startOfDueDay = calendar.startOfDay(for: dueDate)

        if startOfDueDay < startOfToday {
            return .overdue
        }

        if startOfDueDay == startOfToday {
            return .today
        }

        // Boundary mirrors desktop's `computeUrgency` exactly: "this week"
        // is inclusive of the upcoming Sunday; on Sunday itself it
        // extends a full 7 days. Same end-of-Sunday-UTC moment as
        // `TodaySections.bucket()`, just compared with `<=` against
        // `startOfDueDay` (also UTC-stripped) instead of `<` against
        // start-of-Monday — equivalent semantics.
        let weekday = calendar.component(.weekday, from: now)
        let daysUntilEndOfWeek = weekday == 1 ? 7 : (8 - weekday) // Sunday = 1
        let endOfWeek = calendar.date(byAdding: .day, value: daysUntilEndOfWeek, to: startOfToday)!
        if startOfDueDay <= endOfWeek {
            return .thisWeek
        }

        let endOfNextWeek = calendar.date(byAdding: .day, value: 7, to: endOfWeek)!
        if startOfDueDay <= endOfNextWeek {
            return .nextWeek
        }

        return .later
    }

    // Cached formatters — list rendering calls formatRelativeDate once per
    // row, and allocating a DateFormatter each call shows up in Instruments.
    private static let weekdayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEEE"
        return f
    }()

    private static let monthDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMM d"
        return f
    }()

    static func formatRelativeDate(_ date: Date) -> String {
        let calendar = Calendar.current
        let now = Date()

        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInTomorrow(date) { return "Tomorrow" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }

        // Within the same week
        let dayDiff = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
        if dayDiff > 0 && dayDiff < 7 {
            return weekdayFormatter.string(from: date)
        }
        return monthDayFormatter.string(from: date)
    }

    static func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }

    static func formatDayHeader(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMM d"  // "Wednesday, Apr 8"
        return formatter.string(from: date)
    }

    static func meetingDurationText(events: [CalendarEvent]) -> String {
        let totalMinutes = events.reduce(0) { $0 + $1.durationMinutes }
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        if hours > 0 && minutes > 0 {
            return "\(hours)h \(minutes)m"
        } else if hours > 0 {
            return "\(hours)h"
        } else {
            return "\(minutes)m"
        }
    }
}
