import SwiftUI

struct CalendarPage: View {
    @Bindable var store: MockStore
    @State private var selectedDate = Date()

    var body: some View {
        VStack(spacing: 16) {
            // Month header
            Text(selectedDate.formatted(.dateTime.month(.wide).year()))
                .font(BrettTypography.dateHeader)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 8)

            // Week strip
            WeekStrip(selectedDate: $selectedDate, events: store.events)

            // Day timeline in a glass card
            DayTimeline(events: store.todayEvents)
                .background {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(.thinMaterial)
                        .overlay {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                        }
                }
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 16)
        }
    }
}
