import SwiftUI

/// Calendar page — wired to the live `CalendarStore` (SwiftData backed by
/// the sync pull).
struct CalendarPage: View {
    @State private var selectedDate = Date()
    /// Tracks whether the user is still viewing "today" (vs. having
    /// navigated to a specific day via the week strip). When true, the
    /// anchor snaps forward on foreground if the day rolled over while
    /// the app was backgrounded or the device was asleep.
    @State private var pinnedToToday: Bool = true
    @State private var calendarStore = CalendarStore()
    @State private var accountsStore = CalendarAccountsStore()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(AuthManager.self) private var authManager

    @State private var events: [CalendarEvent] = []
    @State private var isShowingConnectSheet = false

    /// Keep ±60 days of events in memory. The sync-pull populates SwiftData;
    /// this is just a bounded read window.
    private let windowDays = 60

    /// Pure helper — public for test access. Given the currently-selected
    /// date, whether the user is pinned to today, and the current wall
    /// clock, returns the date the calendar should snap to. Exposed as a
    /// static so unit tests can drive it without touching SwiftUI state.
    static func snapForwardIfStale(
        selected: Date,
        pinned: Bool,
        now: Date = Date(),
        calendar: Calendar = .current,
    ) -> Date {
        guard pinned, !calendar.isDate(selected, inSameDayAs: now) else {
            return selected
        }
        return now
    }

    var body: some View {
        VStack(spacing: 16) {
            monthHeader

            WeekStrip(selectedDate: $selectedDate, events: events)

            if accountsStore.hasAnyAccount {
                DayTimeline(events: events, selectedDate: selectedDate)
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
            } else {
                connectCTA
            }
        }
        .refreshable { await refresh() }
        .task { await refresh() }
        .onChange(of: selectedDate) { _, new in
            pinnedToToday = Calendar.current.isDate(new, inSameDayAs: Date())
            loadEventsFromCache()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            let snapped = Self.snapForwardIfStale(
                selected: selectedDate,
                pinned: pinnedToToday,
            )
            if snapped != selectedDate {
                selectedDate = snapped
            }
        }
        .sheet(isPresented: $isShowingConnectSheet) {
            ConnectCalendarModal(accountsStore: accountsStore)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackground(Color.black.opacity(0.85))
                .presentationCornerRadius(20)
        }
    }

    private var monthHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(selectedDate.formatted(.dateTime.month(.wide).year()))
                .font(BrettTypography.dateHeader)
                .foregroundStyle(.white)

            // Subtitle matches Inbox + Today — gives the page a consistent
            // header silhouette during side-swipes. Counts events in the
            // currently-selected day so the user knows what they're
            // looking at.
            Text(eventsSubtitle)
                .font(BrettTypography.stats)
                .foregroundStyle(Color.white.opacity(0.55))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private var eventsSubtitle: String {
        let calendar = Calendar.current
        let dayStart = calendar.startOfDay(for: selectedDate)
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart
        let count = events.filter { $0.startTime >= dayStart && $0.startTime < dayEnd }.count
        if count == 0 {
            return "Nothing scheduled"
        }
        return count == 1 ? "1 event" : "\(count) events"
    }

    private var connectCTA: some View {
        VStack(alignment: .leading, spacing: 16) {
            GlassCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("CALENDAR")
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                        .foregroundStyle(Color.white.opacity(0.40))
                    Text("Connect Google Calendar")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.white)
                    Text("See your meetings next to your tasks, and let Brett prep you.")
                        .font(BrettTypography.body)
                        .foregroundStyle(Color.white.opacity(0.60))
                    Button {
                        HapticManager.light()
                        isShowingConnectSheet = true
                    } label: {
                        Text("Connect Google Calendar")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(BrettColors.gold, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .padding(.top, 4)
                }
            }
            .padding(.horizontal, 16)
            Spacer()
        }
    }

    private func refresh() async {
        await accountsStore.fetchAccounts()
        loadEventsFromCache()
    }

    private func loadEventsFromCache() {
        guard let userId = authManager.currentUser?.id else {
            events = []
            return
        }
        let calendar = Calendar.current
        let dayStart = calendar.startOfDay(for: selectedDate)
        let windowStart = calendar.date(byAdding: .day, value: -windowDays, to: dayStart) ?? dayStart
        let windowEnd = calendar.date(byAdding: .day, value: windowDays, to: dayStart) ?? dayStart
        events = calendarStore.fetchEvents(userId: userId, startDate: windowStart, endDate: windowEnd)
    }
}
