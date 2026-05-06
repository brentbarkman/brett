import SwiftData
import SwiftUI

/// Calendar page — wired to live SwiftData via `@Query`. Auth gate around
/// `CalendarPageBody` mirrors the pattern used by `TodayPage` /
/// `InboxPage` / `ListView`: SwiftData's `#Predicate` macro can't read
/// `@Environment` values, so the body subview captures `userId` in `init`
/// and `.id(userId)` remounts on account switch.
///
/// Pre-refactor this page used a `@State [CalendarEvent]` array hydrated
/// imperatively from `CalendarStore.fetchEvents(...)`. New events arriving
/// via SSE updated SwiftData but didn't refresh the array until the user
/// changed day or pulled to refresh — a freshness gap that diverged from
/// every other list surface in the app. The `@Query` here closes that gap
/// AND aligns the file with the established Wave-B pattern.
struct CalendarPage: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            CalendarPageBody(userId: userId)
                .id(userId)
        } else {
            EmptyView()
        }
    }

    // MARK: - Pure helpers (test surface)
    //
    // Re-exposed here on the public type because the tests in
    // `CalendarOfflineFallbackTests` and `CalendarDatePinningTests` call
    // them as `CalendarPage.shouldShowTimeline(...)` /
    // `CalendarPage.snapForwardIfStale(...)`. The implementations live on
    // `CalendarPageBody` so the body subview can use them directly; these
    // shims forward without duplicating the logic.

    /// Test-facing wrapper. See `CalendarPageBody.snapForwardIfStale`.
    static func snapForwardIfStale(
        selected: Date,
        pinned: Bool,
        now: Date = Date(),
        calendar: Calendar = .current,
    ) -> Date {
        CalendarPageBody.snapForwardIfStale(
            selected: selected,
            pinned: pinned,
            now: now,
            calendar: calendar
        )
    }

    /// Test-facing wrapper. See `CalendarPageBody.shouldShowTimeline`.
    static func shouldShowTimeline(hasAccount: Bool, hasCachedEvents: Bool) -> Bool {
        CalendarPageBody.shouldShowTimeline(hasAccount: hasAccount, hasCachedEvents: hasCachedEvents)
    }
}

private struct CalendarPageBody: View {
    let userId: String

    @State private var selectedDate = Date()
    /// Tracks whether the user is still viewing "today" (vs. having
    /// navigated to a specific day via the week strip). When true, the
    /// anchor snaps forward on foreground if the day rolled over while
    /// the app was backgrounded or the device was asleep.
    @State private var pinnedToToday: Bool = true
    @State private var accountsStore = CalendarAccountsStore()
    @Environment(\.scenePhase) private var scenePhase

    @State private var isShowingConnectSheet = false

    /// User-scoped, non-deleted events overlapping a wide window around
    /// today (±90 days). The window is fixed at view-init time — the
    /// `Calendar` page lets users scroll the week strip but in practice
    /// they don't navigate months out, so the bounded predicate keeps
    /// the working set small (vs. fetching every event the user has
    /// ever synced) without forcing a re-init every day. If a user
    /// navigates beyond the window, the WeekStrip + DayTimeline render
    /// empty for those days; the next account refresh / pull restores
    /// the data when it lands inside the window again.
    @Query private var events: [CalendarEvent]

    init(userId: String) {
        self.userId = userId
        let calendar = Calendar.current
        let now = Date()
        // Generous symmetric window — calendars are read-mostly so
        // ±90 days easily covers reasonable navigation without
        // forcing a re-init on day rollover. The week strip caps
        // visible navigation at a few weeks in either direction.
        let windowStart = calendar.date(byAdding: .day, value: -90, to: now) ?? now
        let windowEnd = calendar.date(byAdding: .day, value: 90, to: now) ?? now
        let predicate = #Predicate<CalendarEvent> { event in
            event.deletedAt == nil
                && event.userId == userId
                && event.startTime < windowEnd
                && event.endTime > windowStart
        }
        _events = Query(filter: predicate, sort: \CalendarEvent.startTime)
    }

    /// View-facing event list — the @Query result with declined events
    /// filtered out (matches Google Calendar's default). Done in Swift
    /// rather than the predicate so a future "show declined" toggle can
    /// flip without re-initing the @Query.
    private var visibleEvents: [CalendarEvent] {
        events.filter { $0.myResponseStatus != CalendarRsvpStatus.declined.rawValue }
    }

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

    /// Pure helper — public for test access. Decides whether the calendar
    /// should render the timeline (with whatever events are in the local
    /// cache) versus the "Connect Google Calendar" CTA.
    ///
    /// Account metadata isn't part of the sync-pull (`/calendar/accounts`
    /// is fetched on demand), so when offline `hasAnyAccount` is false even
    /// if the user actually has accounts and cached events. Falling back
    /// on cached-events presence handles that case: if there's any event
    /// in the local SwiftData store, the user must have a connected
    /// account, so show the timeline.
    ///
    /// Edge case: a connected account with zero events in the visible
    /// window (rare) still shows the CTA when offline. Not a regression
    /// vs. the old behaviour — both old and new code hit the CTA there.
    static func shouldShowTimeline(hasAccount: Bool, hasCachedEvents: Bool) -> Bool {
        hasAccount || hasCachedEvents
    }

    var body: some View {
        ZStack {
            // No per-page wash — the global wash in `MainContainer`
            // is the backdrop, and page content slides over it
            // during pager transitions.

            VStack(spacing: 16) {
                monthHeader

                WeekStrip(selectedDate: $selectedDate, events: visibleEvents)

                if Self.shouldShowTimeline(
                    hasAccount: accountsStore.hasAnyAccount,
                    hasCachedEvents: !visibleEvents.isEmpty
                ) {
                    // Canonical card glass — see apps/ios/DESIGN.md
                    // "Canonical card glass". Single material fill at
                    // white/0.07 with a white/0.12 border so the
                    // timeline reads identical to Today's task
                    // sections, the Inbox card, and Lists rows.
                    DayTimeline(events: visibleEvents, selectedDate: selectedDate)
                        .background {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Color.white.opacity(0.07))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
                                }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .padding(.horizontal, 16)
                } else {
                    connectCTA
                }
            }
        }
        .refreshable { await accountsStore.fetchAccounts() }
        .task { await accountsStore.fetchAccounts() }
        .onChange(of: selectedDate) { _, new in
            pinnedToToday = Calendar.current.isDate(new, inSameDayAs: Date())
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

    /// Editorial 38pt serif header per the calm-hero design — parity
    /// with Inbox/Today/Lists/Scouts so swipe transitions don't shift
    /// the header silhouette. Title is the selected day-and-month
    /// ("Monday, May 4") and the subtitle counts events on that day.
    /// Was previously "May 2026" — too coarse, the WeekStrip below
    /// already conveys the month/year, and the user-selected day
    /// deserves the prime real estate.
    private var monthHeader: some View {
        EditorialPageHeader(
            title: selectedDate.formatted(.dateTime.weekday(.wide).month(.wide).day()),
            subtitle: eventsSubtitle
        )
        .padding(.top, 12)
    }

    private var eventsSubtitle: String {
        let calendar = Calendar.current
        let dayStart = calendar.startOfDay(for: selectedDate)
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart
        let count = visibleEvents.filter { $0.startTime >= dayStart && $0.startTime < dayEnd }.count
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

    // Pre-refactor `refresh()` + `loadEventsFromCache()` lived here; both
    // are subsumed by the @Query reactive read. The `accountsStore.fetchAccounts()`
    // call moved inline into `.task` and `.refreshable` because that
    // remains the only network-dependent piece — events themselves come
    // through the sync pull and SSE invalidations into SwiftData, where
    // the @Query observes them automatically.
}
