import Foundation

enum DateHelpers {
    static func computeUrgency(dueDate: Date?, isCompleted: Bool) -> Urgency {
        if isCompleted { return .done }
        guard let dueDate else { return .later }

        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let startOfDueDay = calendar.startOfDay(for: dueDate)

        if startOfDueDay < startOfToday {
            return .overdue
        }

        if calendar.isDate(dueDate, inSameDayAs: now) {
            return .today
        }

        // End of this week (Sunday)
        let endOfWeek = calendar.date(byAdding: .day, value: 7 - calendar.component(.weekday, from: now), to: startOfToday)!
        if startOfDueDay <= endOfWeek {
            return .thisWeek
        }

        // End of next week
        let endOfNextWeek = calendar.date(byAdding: .day, value: 7, to: endOfWeek)!
        if startOfDueDay <= endOfNextWeek {
            return .nextWeek
        }

        return .later
    }

    static func formatRelativeDate(_ date: Date) -> String {
        let calendar = Calendar.current
        let now = Date()

        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInTomorrow(date) { return "Tomorrow" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }

        let formatter = DateFormatter()
        // Within the same week
        let dayDiff = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 0
        if dayDiff > 0 && dayDiff < 7 {
            formatter.dateFormat = "EEEE"  // "Wednesday"
            return formatter.string(from: date)
        }

        formatter.dateFormat = "MMM d"     // "Apr 11"
        return formatter.string(from: date)
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
