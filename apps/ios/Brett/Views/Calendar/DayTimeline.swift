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

    private var startHour: Int {
        let base = 6
        let minHour = timedEvents.map { calendar.component(.hour, from: $0.startTime) }.min() ?? base
        return min(base, minHour)
    }

    private var endHour: Int {
        let base = 23
        let maxHour = timedEvents.compactMap { evt -> Int? in
            let endHour = calendar.component(.hour, from: evt.endTime)
            let endMin = calendar.component(.minute, from: evt.endTime)
            return endMin > 0 ? endHour + 1 : endHour
        }.max() ?? base
        return max(base, min(maxHour, 23))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if !allDayEvents.isEmpty {
                    allDayBand
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 4)
                }
                timelineGrid
            }
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
    }

    @ViewBuilder
    private var allDayBand: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("ALL DAY")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(Color.white.opacity(0.40))

            ForEach(allDayEvents) { event in
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
    private var timelineGrid: some View {
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

            ForEach(timedEvents) { event in
                eventChip(event)
            }

            if calendar.isDateInToday(selectedDate) {
                currentTimeIndicator
            }
        }
    }

    @ViewBuilder
    private func eventChip(_ event: CalendarEvent) -> some View {
        let startHourD = Double(calendar.component(.hour, from: event.startTime))
        let startMin = Double(calendar.component(.minute, from: event.startTime))
        let offset = CGFloat((startHourD - Double(startHour)) * Double(hourHeight) + (startMin / 60.0) * Double(hourHeight))

        let durationMin = max(Double(event.endTime.timeIntervalSince(event.startTime) / 60.0), 15)
        let height = CGFloat(durationMin / 60.0) * hourHeight
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

    @ViewBuilder
    private var currentTimeIndicator: some View {
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
