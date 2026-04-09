import SwiftUI

struct WeekStrip: View {
    @Binding var selectedDate: Date
    let events: [MockEvent]

    private let calendar = Calendar.current
    private let dayLabels = ["M", "T", "W", "T", "F", "S", "S"]

    private var weekDays: [Date] {
        let today = calendar.startOfDay(for: Date())
        let weekday = calendar.component(.weekday, from: today)
        // Start on Monday (weekday 2 in Gregorian)
        let monday = calendar.date(byAdding: .day, value: -(weekday == 1 ? 6 : weekday - 2), to: today)!
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: monday) }
    }

    var body: some View {
        GlassCard {
            HStack(spacing: 0) {
                ForEach(Array(weekDays.enumerated()), id: \.offset) { index, day in
                    let isToday = calendar.isDateInToday(day)
                    let isSelected = calendar.isDate(day, inSameDayAs: selectedDate)

                    Button {
                        selectedDate = day
                    } label: {
                        VStack(spacing: 6) {
                            Text(dayLabels[index])
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.4))

                            ZStack {
                                if isToday {
                                    Circle()
                                        .fill(BrettColors.gold)
                                        .frame(width: 32, height: 32)
                                } else if isSelected {
                                    Circle()
                                        .fill(Color.white.opacity(0.15))
                                        .frame(width: 32, height: 32)
                                }

                                Text("\(calendar.component(.day, from: day))")
                                    .font(.system(size: 15, weight: isToday ? .bold : .regular))
                                    .foregroundStyle(isToday ? .black : .white)
                            }

                            // Event dot
                            Circle()
                                .fill(hasEvents(on: day) ? BrettColors.gold.opacity(0.6) : Color.clear)
                                .frame(width: 4, height: 4)
                        }
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private func hasEvents(on date: Date) -> Bool {
        // For mock data, all events are "today"
        calendar.isDateInToday(date) && !events.isEmpty
    }
}
