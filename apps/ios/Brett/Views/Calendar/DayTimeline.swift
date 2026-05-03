import SwiftUI

/// Hourly vertical timeline rendering `CalendarEvent`s for the selected day.
///
/// - Window 6 AM–11 PM by default; auto-expands earlier/later when events fall outside.
/// - Events rendered as absolutely-positioned glass chips with a coloured left accent.
/// - Current-time indicator (gold line + dot) only when the selected day is today.
/// - All-day events pinned as chips above the grid so they don't collide with timed blocks.
/// - Tap an event → `NavigationLink(value: .eventDetail(id:))`.
struct DayTimeline: View {
    let events: [CalendarEvent]
    let selectedDate: Date

    let hourHeight: CGFloat = 60

    private var calendar: Calendar { Calendar.current }

    private var timedEvents: [CalendarEvent] {
        let start = calendar.startOfDay(for: selectedDate)
        guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { return [] }
        return events
            .filter { !$0.isAllDay && $0.startTime < end && $0.endTime > start && $0.deletedAt == nil }
            .sorted { $0.startTime < $1.startTime }
    }

    private var allDayEvents: [CalendarEvent] {
        let start = calendar.startOfDay(for: selectedDate)
        guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { return [] }
        return events
            .filter { $0.isAllDay && $0.startTime < end && $0.endTime > start && $0.deletedAt == nil }
            .sorted { $0.title < $1.title }
    }

    private func resolveStartHour(timed: [CalendarEvent]) -> Int {
        Self.resolveStartHour(timed: timed, selectedDate: selectedDate, calendar: calendar)
    }

    private func resolveEndHour(timed: [CalendarEvent]) -> Int {
        Self.resolveEndHour(timed: timed, selectedDate: selectedDate, calendar: calendar)
    }

    /// First hour shown in the visible window. Defaults to 6 AM, expanded
    /// earlier when an event in the day starts before then. Multi-day
    /// events are clipped to the day's start (00:00) so a flight that
    /// began before midnight pulls the window down to hour 0 rather than
    /// reading the *original* start hour from a previous day.
    static func resolveStartHour(
        timed: [CalendarEvent],
        selectedDate: Date,
        calendar: Calendar
    ) -> Int {
        let base = 6
        let dayStart = calendar.startOfDay(for: selectedDate)
        let minHour = timed.map { evt -> Int in
            let clipped = max(evt.startTime, dayStart)
            return calendar.component(.hour, from: clipped)
        }.min() ?? base
        return min(base, minHour)
    }

    /// Last hour shown in the visible window. Defaults to 11 PM, capped
    /// at 23 even when an event runs past midnight (the chip itself is
    /// clipped to the day's end).
    static func resolveEndHour(
        timed: [CalendarEvent],
        selectedDate: Date,
        calendar: Calendar
    ) -> Int {
        let base = 23
        let dayStart = calendar.startOfDay(for: selectedDate)
        guard let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) else {
            return base
        }
        let maxHour = timed.compactMap { evt -> Int? in
            let clipped = min(evt.endTime, dayEnd)
            let endHour = calendar.component(.hour, from: clipped)
            let endMin = calendar.component(.minute, from: clipped)
            // An event that ends exactly at midnight (the day's `dayEnd`)
            // returns hour 0 from `component(.hour:)`. Treat it as 24 so
            // the visible window doesn't silently shrink to the base 23.
            if calendar.isDate(clipped, equalTo: dayEnd, toGranularity: .second) {
                return 24
            }
            return endMin > 0 ? endHour + 1 : endHour
        }.max() ?? base
        return max(base, min(maxHour, 23))
    }

    var body: some View {
        // Compute the day-filtered event lists + visible hour window once
        // per body pass, then thread them through to the grid and chips.
        // Without hoisting, each chip's position math would retrigger the
        // full-events filter that backs `timedEvents`, making grid render
        // cost scale as O(events × chips) instead of O(events).
        let allDay = allDayEvents
        let timed = timedEvents
        let visibleStart = resolveStartHour(timed: timed)
        let visibleEnd = resolveEndHour(timed: timed)

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if !allDay.isEmpty {
                    allDayBand(events: allDay)
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 4)
                }
                timelineGrid(timed: timed, startHour: visibleStart, endHour: visibleEnd)
            }
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
    }

    @ViewBuilder
    private func allDayBand(events: [CalendarEvent]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ALL DAY")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(Color.white.opacity(0.40))

            ForEach(events) { event in
                NavigationLink(value: NavDestination.eventDetail(id: event.id)) {
                    HStack(spacing: 8) {
                        Rectangle()
                            .fill(EventColorPalette.color(forGoogleColorId: event.googleColorId))
                            .frame(width: 3)
                            .clipShape(RoundedRectangle(cornerRadius: 1.5))
                        Text(event.title)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(BrettColors.textPrimary)
                            .lineLimit(1)
                        Spacer()
                    }
                    .padding(.vertical, 6)
                    .padding(.horizontal, 8)
                    .background {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(.ultraThinMaterial)
                            .overlay {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.05), lineWidth: 0.5)
                            }
                    }
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture().onEnded { HapticManager.light() })
            }
        }
    }

    @ViewBuilder
    private func timelineGrid(timed: [CalendarEvent], startHour: Int, endHour: Int) -> some View {
        ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
                ForEach(startHour...endHour, id: \.self) { hour in
                    HStack(alignment: .top, spacing: 8) {
                        Text(Self.formatHour(hour))
                            .font(.system(size: 11, weight: .regular))
                            .foregroundStyle(Color.white.opacity(0.25))
                            .frame(width: 45, alignment: .trailing)
                        Rectangle()
                            .fill(Color.white.opacity(0.05))
                            .frame(height: 0.5)
                            .frame(maxWidth: .infinity)
                    }
                    .frame(height: hourHeight)
                }
            }

            ForEach(timed) { event in
                eventChip(event, startHour: startHour)
            }

            if calendar.isDateInToday(selectedDate) {
                currentTimeIndicator(startHour: startHour, endHour: endHour)
            }
        }
    }

    @ViewBuilder
    private func eventChip(_ event: CalendarEvent, startHour: Int) -> some View {
        let layout = Self.chipLayout(
            eventStart: event.startTime,
            eventEnd: event.endTime,
            selectedDate: selectedDate,
            startHour: startHour,
            hourHeight: hourHeight,
            calendar: calendar
        )
        let offset = layout.offset
        let height = layout.height
        let meta = Self.metaLine(for: event)
        let minHeight = Self.chipMinHeight(hasMeta: meta != nil)

        NavigationLink(value: NavDestination.eventDetail(id: event.id)) {
            HStack(spacing: 0) {
                Rectangle()
                    .fill(EventColorPalette.color(forGoogleColorId: event.googleColorId))
                    .frame(width: 3)
                    .clipShape(RoundedRectangle(cornerRadius: 1.5))
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.title)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(BrettColors.textPrimary)
                        .lineLimit(1)
                    if let meta {
                        Text(meta)
                            .font(.system(size: 11))
                            .foregroundStyle(BrettColors.textSecondary)
                            .lineLimit(1)
                    }
                }
                .padding(.leading, 8)
                .padding(.vertical, 6)
                Spacer()
            }
            .frame(minHeight: max(height - 4, minHeight), alignment: .top)
            .background {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.05), lineWidth: 0.5)
                    }
            }
        }
        .buttonStyle(.plain)
        .simultaneousGesture(TapGesture().onEnded { HapticManager.light() })
        .padding(.leading, 58)
        .padding(.trailing, 16)
        .offset(y: offset)
    }

    /// Minimum vertical size a timed-event chip needs so all text lines stay
    /// inside the background. A chip without a meta line only shows the title
    /// (13pt, one line), while a chip with a meta line needs room for both.
    static func chipMinHeight(hasMeta: Bool) -> CGFloat {
        hasMeta ? 46 : 28
    }

    /// Vertical placement (offset from grid top) and height for a timed-event
    /// chip on a single-day timeline.
    ///
    /// Multi-day events (e.g. a flight from Mon 5pm to Wed 9am) are clipped
    /// to the selected day's window before the offset / height are computed.
    /// Without clipping the chip would render at the *original* start hour
    /// (5pm) with the *full* duration's height (44h * hourHeight) on every
    /// day the event overlaps — so a 12h flight viewed on the day it ends
    /// would render a 720pt-tall chip starting at 5pm, completely
    /// overflowing the visible grid.
    ///
    /// - `eventStart` / `eventEnd`: the event's wall-clock range.
    /// - `selectedDate`: any moment inside the day being rendered (the day's
    ///   start is computed via `calendar.startOfDay`).
    /// - `startHour`: the first hour shown in the visible grid window.
    /// - Returns the chip's `offset` from the top of the grid (in points)
    ///   and its raw `height` (caller still applies `chipMinHeight` as a
    ///   floor for short events).
    static func chipLayout(
        eventStart: Date,
        eventEnd: Date,
        selectedDate: Date,
        startHour: Int,
        hourHeight: CGFloat,
        calendar: Calendar
    ) -> (offset: CGFloat, height: CGFloat) {
        let dayStart = calendar.startOfDay(for: selectedDate)
        guard let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) else {
            return (0, 0)
        }

        // Clip the event to the visible day so multi-day events render
        // only their in-day portion.
        let clippedStart = max(eventStart, dayStart)
        let clippedEnd = min(eventEnd, dayEnd)
        // Defensive: an event that doesn't overlap the day shouldn't reach
        // this helper (the timed-events filter already excludes it), but if
        // it does we return a zero-sized layout rather than negative values.
        guard clippedEnd > clippedStart else { return (0, 0) }

        // Minutes from the start of the day to the clipped event start.
        let minutesFromDayStart = clippedStart.timeIntervalSince(dayStart) / 60.0
        // Minutes from the start of the visible window to the clipped start.
        let minutesFromWindow = minutesFromDayStart - Double(startHour) * 60.0
        let offset = CGFloat(minutesFromWindow / 60.0 * Double(hourHeight))

        // 15-min minimum mirrors the previous behaviour so very-short events
        // still render a tappable chip; the rendered chip also enforces a
        // text-driven floor via `chipMinHeight`.
        let durationMin = max(clippedEnd.timeIntervalSince(clippedStart) / 60.0, 15)
        let height = CGFloat(durationMin / 60.0 * Double(hourHeight))

        return (offset, height)
    }

    @ViewBuilder
    private func currentTimeIndicator(startHour: Int, endHour: Int) -> some View {
        let now = Date()
        let hour = calendar.component(.hour, from: now)
        let minute = calendar.component(.minute, from: now)
        let inWindow = hour >= startHour && hour <= endHour
        if inWindow {
            let y = CGFloat(hour - startHour) * hourHeight + CGFloat(minute) / 60.0 * hourHeight
            HStack(spacing: 0) {
                Circle().fill(BrettColors.gold).frame(width: 8, height: 8).padding(.leading, 50)
                Rectangle().fill(BrettColors.gold).frame(height: 1)
            }
            .offset(y: y - 4)
        }
    }

    static func formatHour(_ hour: Int) -> String {
        if hour == 0 { return "12 AM" }
        if hour < 12 { return "\(hour) AM" }
        if hour == 12 { return "12 PM" }
        return "\(hour - 12) PM"
    }

    static func metaLine(for event: CalendarEvent) -> String? {
        let durationMinutes = max(Int(event.endTime.timeIntervalSince(event.startTime) / 60), 0)
        if let location = event.location, !location.isEmpty {
            return "\(location) · \(durationMinutes)min"
        }
        if let link = event.meetingLink, !link.isEmpty {
            return "\(displayHost(for: link)) · \(durationMinutes)min"
        }
        return nil
    }

    static func displayHost(for link: String) -> String {
        guard let url = URL(string: link), let host = url.host else { return link }
        return host.replacingOccurrences(of: "www.", with: "")
    }
}
