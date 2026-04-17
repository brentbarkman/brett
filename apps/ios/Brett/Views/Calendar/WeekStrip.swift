import SwiftUI

/// Horizontal 21-day scroll strip (previous week + current week + next week).
/// Tap a day to select it. The strip auto-scrolls the selected day into view
/// whenever the binding changes from the outside (e.g. week-swipe nav).
///
/// Event dots: up to 3 coloured dots are rendered under a day when the
/// calendar has events on it. Colours come from the event's `googleColorId`
/// (via the palette mapping) — fall back to gold when unmapped.
struct WeekStrip: View {
    @Binding var selectedDate: Date
    let events: [CalendarEvent]

    private let calendar = Calendar.current

    private var windowDays: [Date] {
        let today = calendar.startOfDay(for: Date())
        let weekday = calendar.component(.weekday, from: today)
        guard let currentWeekStart = calendar.date(byAdding: .day, value: -(weekday - 1), to: today),
              let windowStart = calendar.date(byAdding: .day, value: -7, to: currentWeekStart) else {
            return []
        }
        return (0..<21).compactMap { calendar.date(byAdding: .day, value: $0, to: windowStart) }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(windowDays, id: \.timeIntervalSince1970) { day in
                        dayCell(day)
                            .id(Self.anchorId(for: day, calendar: calendar))
                    }
                }
                .padding(.horizontal, 16)
            }
            .onAppear {
                proxy.scrollTo(Self.anchorId(for: selectedDate, calendar: calendar), anchor: .center)
            }
            .onChange(of: selectedDate) { _, newValue in
                withAnimation(.easeOut(duration: 0.25)) {
                    proxy.scrollTo(Self.anchorId(for: newValue, calendar: calendar), anchor: .center)
                }
            }
        }
    }

    @ViewBuilder
    private func dayCell(_ day: Date) -> some View {
        let isToday = calendar.isDateInToday(day)
        let isSelected = calendar.isDate(day, inSameDayAs: selectedDate)
        let dots = dotColors(for: day)
        let dayLabel = Self.shortWeekdayLabel(for: day, calendar: calendar)

        Button {
            HapticManager.light()
            selectedDate = day
        } label: {
            VStack(spacing: 6) {
                Text(dayLabel)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(isSelected || isToday ? 0.60 : 0.40))

                ZStack {
                    if isToday {
                        Circle().fill(BrettColors.gold).frame(width: 34, height: 34)
                    } else if isSelected {
                        Circle().fill(Color.white.opacity(0.15)).frame(width: 34, height: 34)
                    }
                    Text("\(calendar.component(.day, from: day))")
                        .font(.system(size: 15, weight: isToday ? .bold : .regular))
                        .foregroundStyle(isToday ? .black : Color.white.opacity(isSelected ? 1.0 : 0.85))
                }

                HStack(spacing: 3) {
                    if dots.isEmpty {
                        Circle().fill(Color.clear).frame(width: 4, height: 4)
                    } else {
                        ForEach(Array(dots.prefix(3).enumerated()), id: \.offset) { _, color in
                            Circle().fill(color).frame(width: 4, height: 4)
                        }
                    }
                }
                .frame(height: 4)
            }
            .frame(width: 44)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
    }

    private func dotColors(for day: Date) -> [Color] {
        let start = calendar.startOfDay(for: day)
        guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { return [] }
        let dayEvents = events.filter { evt in
            evt.deletedAt == nil && evt.startTime < end && evt.endTime > start
        }
        return dayEvents.map { EventColorPalette.color(forGoogleColorId: $0.googleColorId) }
    }

    static func anchorId(for date: Date, calendar: Calendar) -> String {
        let comps = calendar.dateComponents([.year, .month, .day], from: date)
        return "\(comps.year ?? 0)-\(comps.month ?? 0)-\(comps.day ?? 0)"
    }

    static func shortWeekdayLabel(for date: Date, calendar: Calendar) -> String {
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        let weekday = calendar.component(.weekday, from: date)
        let index = (weekday - 1) % symbols.count
        return symbols[index]
    }
}

enum EventColorPalette {
    private static let map: [String: Color] = [
        "1":  Color(red: 124/255, green: 181/255, blue: 236/255),
        "2":  Color(red: 114/255, green: 191/255, blue: 172/255),
        "3":  Color(red: 145/255, green: 122/255, blue: 204/255),
        "4":  Color(red: 244/255, green: 117/255, blue: 115/255),
        "5":  Color(red: 251/255, green: 188/255, blue:  66/255),
        "6":  Color(red: 255/255, green: 135/255, blue:  89/255),
        "7":  Color(red:  70/255, green: 130/255, blue: 195/255),
        "8":  Color(red: 151/255, green: 151/255, blue: 151/255),
        "9":  Color(red:  91/255, green: 137/255, blue: 217/255),
        "10": Color(red:  80/255, green: 180/255, blue: 130/255),
        "11": Color(red: 220/255, green:  85/255, blue:  85/255),
    ]

    static func color(forGoogleColorId id: String?) -> Color {
        guard let id, let c = map[id] else { return BrettColors.gold }
        return c
    }
}
