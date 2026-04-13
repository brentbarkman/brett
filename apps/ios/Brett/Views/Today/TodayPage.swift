import SwiftUI

struct TodayPage: View {
    @Bindable var store: MockStore
    @State private var selectedItemId: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                DayHeader(
                    completedCount: store.completedTasks,
                    totalCount: store.totalTasks,
                    meetingCount: store.meetingCount,
                    meetingDuration: store.meetingDuration
                )
                .padding(.top, 12)

                // Briefing
                DailyBriefing(
                    text: store.briefing,
                    isCollapsed: $store.briefingCollapsed,
                    isDismissed: $store.briefingDismissed
                )

                // Overdue
                TaskSection(
                    label: "Overdue",
                    items: store.overdueItems,
                    labelColor: BrettColors.error,
                    accentColor: BrettColors.error,
                    onToggle: { store.toggleItem($0) },
                    onTap: { selectedItemId = $0 }
                )

                // Today
                TaskSection(
                    label: "Today",
                    items: store.todayItems,
                    labelColor: BrettColors.goldLabel,
                    onToggle: { store.toggleItem($0) },
                    onTap: { selectedItemId = $0 }
                )

                // This Week
                TaskSection(
                    label: "This Week",
                    items: store.thisWeekItems,
                    labelColor: BrettColors.textTertiary,
                    onToggle: { store.toggleItem($0) },
                    onTap: { selectedItemId = $0 }
                )

                // Next Week
                TaskSection(
                    label: "Next Week",
                    items: store.nextWeekItems,
                    labelColor: BrettColors.textTertiary,
                    onToggle: { store.toggleItem($0) },
                    onTap: { selectedItemId = $0 }
                )

                // Done Today
                TaskSection(
                    label: "Done Today",
                    items: store.doneItems,
                    labelColor: BrettColors.textTertiary,
                    onToggle: { store.toggleItem($0) },
                    onTap: { selectedItemId = $0 }
                )

                Spacer(minLength: 20)
            }
        }
        .scrollIndicators(.hidden)
        .navigationDestination(for: String.self) { itemId in
            TaskDetailView(store: store, itemId: itemId)
        }
    }
}
