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
                .padding(.top, 60)

            // Week strip
            WeekStrip(selectedDate: $selectedDate, events: store.events)

            // Day timeline
            DayTimeline(events: store.todayEvents)
        }
    }
}
