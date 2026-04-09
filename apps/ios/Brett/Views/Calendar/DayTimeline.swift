import SwiftUI

struct DayTimeline: View {
    let events: [MockEvent]
    let hourHeight: CGFloat = 60

    private let startHour = 7
    private let endHour = 20

    var body: some View {
        ScrollView {
            ZStack(alignment: .topLeading) {
                // Hour lines
                VStack(spacing: 0) {
                    ForEach(startHour...endHour, id: \.self) { hour in
                        HStack(alignment: .top, spacing: 8) {
                            Text(formatHour(hour))
                                .font(.system(size: 11, weight: .regular))
                                .foregroundStyle(Color.white.opacity(0.25))
                                .frame(width: 45, alignment: .trailing)

                            Rectangle()
                                .fill(Color.white.opacity(0.06))
                                .frame(height: 0.5)
                                .frame(maxWidth: .infinity)
                        }
                        .frame(height: hourHeight)
                    }
                }

                // Event blocks
                ForEach(events) { event in
                    let yOffset = CGFloat(event.startHour - startHour) * hourHeight +
                                  CGFloat(event.startMinute) / 60.0 * hourHeight
                    let height = CGFloat(event.durationMinutes) / 60.0 * hourHeight

                    HStack(spacing: 0) {
                        Rectangle()
                            .fill(Color(hex: event.color) ?? BrettColors.gold)
                            .frame(width: 3)
                            .clipShape(RoundedRectangle(cornerRadius: 1.5))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(BrettColors.textPrimary)

                            if let location = event.location {
                                Text("\(location) · \(event.durationMinutes)min")
                                    .font(.system(size: 11))
                                    .foregroundStyle(BrettColors.textSecondary)
                            } else if let link = event.meetingLink {
                                Text("\(link) · \(event.durationMinutes)min")
                                    .font(.system(size: 11))
                                    .foregroundStyle(BrettColors.textSecondary)
                            }
                        }
                        .padding(.leading, 8)
                        .padding(.vertical, 6)

                        Spacer()
                    }
                    .frame(height: max(height - 4, 28))
                    .background {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(.ultraThinMaterial)
                            .overlay {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
                            }
                    }
                    .padding(.leading, 58)
                    .padding(.trailing, 16)
                    .offset(y: yOffset)
                }

                // Current time indicator
                currentTimeIndicator
            }
            .padding(.bottom, 100)
        }
        .scrollIndicators(.hidden)
    }

    @ViewBuilder
    private var currentTimeIndicator: some View {
        let now = Date()
        let cal = Calendar.current
        let hour = cal.component(.hour, from: now)
        let minute = cal.component(.minute, from: now)

        if hour >= startHour && hour <= endHour {
            let y = CGFloat(hour - startHour) * hourHeight + CGFloat(minute) / 60.0 * hourHeight

            HStack(spacing: 0) {
                Circle()
                    .fill(BrettColors.gold)
                    .frame(width: 8, height: 8)
                    .padding(.leading, 50)

                Rectangle()
                    .fill(BrettColors.gold)
                    .frame(height: 1)
            }
            .offset(y: y - 4)
        }
    }

    private func formatHour(_ hour: Int) -> String {
        if hour == 0 { return "12 AM" }
        if hour < 12 { return "\(hour) AM" }
        if hour == 12 { return "12 PM" }
        return "\(hour - 12) PM"
    }
}

// Color hex extension
extension Color {
    init?(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: UInt64
        switch hex.count {
        case 6:
            (r, g, b) = ((int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            return nil
        }
        self.init(red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255)
    }
}
