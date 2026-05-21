import Foundation

enum DateHelpers {
    /// UTC calendar — used for reading the calendar-date components of a
    /// stored `dueDate`. The storage convention is "UTC midnight of the
    /// user's intended local calendar date" (matches desktop's
    /// `packages/business/src/index.ts`), so extracting UTC components
    /// recovers the calendar date the user picked.
    static let utcCalendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    /// Encode a moment as the UTC midnight that represents its calendar
    /// date in `localCalendar`'s timezone. This is the storage convention
    /// for `dueDate` — every preset resolves through this and every read
    /// can trust the result is already canonical (the API migration
    /// `20260515230000_normalize_due_date_to_utc_midnight_and_friday`
    /// snapped historical rows).
    ///
    /// Example: `now = 2026-05-15T21:43-06:00` (Friday evening MDT) →
    /// `2026-05-15T00:00:00.000Z`. Without this anchor, iOS-on-MDT would
    /// store `2026-05-15T06:00:00Z` (local midnight), which on read
    /// extracts as the *previous* UTC day and bucketizes wrong.
    static func utcMidnightOfLocalDate(_ moment: Date, in localCalendar: Calendar) -> Date {
        let local = localCalendar.dateComponents([.year, .month, .day], from: moment)
        var utc = DateComponents()
        utc.year = local.year
        utc.month = local.month
        utc.day = local.day
        utc.timeZone = TimeZone(identifier: "UTC")
        // The TZ on `utc` makes the calendar irrelevant for this conversion.
        return Calendar(identifier: .gregorian).date(from: utc)!
    }

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
            // nextWeekEnd: 13 (was 8) so the Friday-after-next picked by the
            // `next_week` preset on Sat lands in `nextWeek` instead of
            // dropping to `later`. Matches the desktop range exactly.
            return UrgencyRanges(thisWeekStart: 2, thisWeekEnd: 6, thisWeekendStart: 1, thisWeekendEnd: 1, nextWeekEnd: 13)
        }
        return UrgencyRanges(
            thisWeekStart: 1,
            thisWeekEnd: 5 - dow,
            thisWeekendStart: 6 - dow,
            thisWeekendEnd: 7 - dow,
            nextWeekEnd: 14 - dow
        )
    }

    static func computeUrgency(
        dueDate: Date?,
        isCompleted: Bool,
        now: Date = Date(),
        localCalendar: Calendar = .current
    ) -> Urgency {
        if isCompleted { return .done }
        guard let dueDate else { return .later }

        // "Today" = UTC-midnight anchor of the user's LOCAL calendar date.
        // Using UTC for both today and dueDate would flip the bucket near
        // midnight (see QuickScheduleTimezoneTests).
        let startOfToday = utcMidnightOfLocalDate(now, in: localCalendar)

        if dueDate < startOfToday { return .overdue }

        // Weekday of the user's local today (derived from the UTC-midnight
        // anchor, which carries the local date in its UTC components).
        let weekday = utcCalendar.component(.weekday, from: startOfToday)
        let r = urgencyRanges(weekday: weekday)
        let diff = utcCalendar.dateComponents([.day], from: startOfToday, to: dueDate).day ?? 0
        if diff == 0 { return .today }
        let dueWeekday = utcCalendar.component(.weekday, from: dueDate)
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

    /// Format a stored `dueDate` against the user's local "today". Critical
    /// to interpret `date` via UTC components (the storage convention) and
    /// "today" via local components — using `Calendar.current` for both
    /// flips the answer near midnight because the stored UTC-midnight value
    /// translates to "yesterday evening" in any TZ west of UTC.
    static func formatRelativeDate(
        _ date: Date,
        now: Date = Date(),
        localCalendar: Calendar = .current
    ) -> String {
        let startOfToday = utcMidnightOfLocalDate(now, in: localCalendar)
        let dayDiff = utcCalendar.dateComponents([.day], from: startOfToday, to: date).day ?? 0

        if dayDiff == 0 { return "Today" }
        if dayDiff == 1 { return "Tomorrow" }
        if dayDiff == -1 { return "Yesterday" }

        // Within the same week (forward), show weekday name. Use the UTC
        // calendar to read the date so the label matches the calendar grid.
        if dayDiff > 0 && dayDiff < 7 {
            return Self.utcWeekdayFormatter.string(from: date)
        }
        return Self.utcMonthDayFormatter.string(from: date)
    }

    private static let utcWeekdayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "EEEE"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    /// Weekday name ("Monday", "Tuesday") of a stored `dueDate`. Reads
    /// the date through `utcCalendar` because the storage convention is
    /// "UTC midnight of the user's local calendar date" — formatting in
    /// the device TZ would flip the weekday near midnight (UTC-midnight
    /// reads as the previous day in any TZ west of UTC).
    static func weekdayName(of date: Date) -> String {
        utcWeekdayFormatter.string(from: date)
    }

    private static let utcMonthDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MMM d"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

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
