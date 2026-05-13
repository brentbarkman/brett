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

    /// Day-offset ranges (relative to today) used to classify due dates
    /// into the four forward-looking urgency buckets. Mirrors the TS
    /// `urgencyBucketRanges` helper in `packages/business/src/index.ts`
    /// exactly — change one, change the other.
    private struct UrgencyRanges {
        let thisWeekStart: Int
        let thisWeekEnd: Int
        let thisWeekendStart: Int
        let thisWeekendEnd: Int
        let nextWeekEnd: Int
    }

    private static func urgencyRanges(weekday: Int) -> UrgencyRanges {
        // Apple's Calendar.weekday: Sun=1..Sat=7. Convert to JS-style
        // 0=Sun..6=Sat so the math reads the same as desktop.
        let dow = weekday - 1
        if dow == 0 {
            return UrgencyRanges(thisWeekStart: 1, thisWeekEnd: 5, thisWeekendStart: 6, thisWeekendEnd: 7, nextWeekEnd: 14)
        }
        if dow == 6 {
            return UrgencyRanges(thisWeekStart: 2, thisWeekEnd: 6, thisWeekendStart: 1, thisWeekendEnd: 1, nextWeekEnd: 8)
        }
        return UrgencyRanges(
            thisWeekStart: 1,
            thisWeekEnd: 5 - dow,
            thisWeekendStart: 6 - dow,
            thisWeekendEnd: 7 - dow,
            nextWeekEnd: 14 - dow
        )
    }

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

        let weekday = calendar.component(.weekday, from: now)
        let r = urgencyRanges(weekday: weekday)
        let diff = calendar.dateComponents([.day], from: startOfToday, to: startOfDueDay).day ?? 0
        let dueWeekday = calendar.component(.weekday, from: startOfDueDay)
        let isWeekendDay = dueWeekday == 1 || dueWeekday == 7 // Sun or Sat

        if isWeekendDay && diff >= r.thisWeekendStart && diff <= r.thisWeekendEnd {
            return .thisWeekend
        }
        if !isWeekendDay && diff >= r.thisWeekStart && diff <= r.thisWeekEnd {
            return .thisWeek
        }
        if diff <= r.nextWeekEnd {
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
