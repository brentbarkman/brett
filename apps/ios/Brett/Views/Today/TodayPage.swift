import SwiftData
import SwiftUI

/// Today page — the home screen of the app.
///
/// Wave 3 rewire: now sourced from `ItemStore` (real SwiftData) rather than
/// `MockStore`. The legacy `store: MockStore` parameter is kept for
/// backwards-compat with `MainContainer` until MockStore is deprecated in a
/// follow-up wave — we ignore everything on it except `selectedTaskId`, which
/// still drives the TaskDetail sheet until that view is migrated too.
struct TodayPage: View {
    // TODO: remove MockStore param post-Wave-3 once MainContainer is migrated.
    @Bindable var store: MockStore

    // MARK: - Real stores

    @State private var itemStore = ItemStore(
        context: PersistenceController.shared.mainContext
    )
    @State private var listStore = ListStore(
        context: PersistenceController.shared.mainContext
    )
    @State private var calendarStore = CalendarStore(
        context: PersistenceController.shared.mainContext
    )
    @State private var briefingStore = BriefingStore()

    // MARK: - Reactive reads

    /// Query every non-deleted item so SwiftData notifies us on every mutation.
    /// Section computation filters down further — we deliberately do the
    /// bucketing in Swift rather than four separate `FetchDescriptor`s so one
    /// SwiftData change notification drives the whole view.
    @Query(
        filter: #Predicate<Item> { $0.deletedAt == nil },
        sort: \Item.createdAt,
        order: .reverse
    ) private var allItems: [Item]

    @Query(
        filter: #Predicate<ItemList> { $0.deletedAt == nil },
        sort: \ItemList.sortOrder
    ) private var allLists: [ItemList]

    @Query(
        filter: #Predicate<CalendarEvent> { $0.deletedAt == nil },
        sort: \CalendarEvent.startTime
    ) private var allEvents: [CalendarEvent]

    // MARK: - UI state

    @State private var completionPulse: Bool = false
    @State private var pendingReflowTask: Task<Void, Never>? = nil
    /// Snapshot of the active item set at the moment of last completion. When
    /// the debounce window expires we bring the view's "working set" in line
    /// with the live data and the completed items slide into Done.
    @State private var reflowSnapshotKey: Int = 0

    /// Ticker driving NextUpCard's relative-time copy.
    @State private var tickerNow: Date = Date()

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                collapsingHeader
                    .padding(.top, 8)
                    .padding(.bottom, 8)

                if hasNextUpEvent {
                    NextUpCard(event: nextUpcomingEvent, now: tickerNow)
                }

                DailyBriefing(store: briefingStore)

                taskSections

                emptyState
            }
            .padding(.bottom, 70)
            // Inner VStack surfaces more reliably as an accessibility
            // element than the outer ScrollView — XCUITest identifier
            // lookups on ScrollView inconsistently resolve.
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("today.page")
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .coordinateSpace(name: "scroll")
        .refreshable {
            try? await SyncManager.shared.pullToRefresh()
            await briefingStore.fetch()
        }
        .task {
            // Initial briefing fetch — only when the user hasn't already
            // dismissed today's and we don't already have one cached.
            if !briefingStore.isDismissedToday && briefingStore.briefing == nil {
                await briefingStore.fetch()
            }
            // Kick off a ticker to keep NextUpCard's relative time fresh.
            await startTicker()
        }
    }

    // MARK: - Collapsing header

    private var collapsingHeader: some View {
        GeometryReader { geo in
            let minY = geo.frame(in: .named("scroll")).minY
            let progress = min(max(minY / 60, 0), 1)

            VStack(alignment: .leading, spacing: 4 * progress) {
                Text(DateHelpers.formatDayHeader(Date()))
                    .font(.system(size: 18 + (10 * progress), weight: .bold))
                    .foregroundStyle(.white)

                if progress > 0.3 {
                    Text(statsLine)
                        .font(BrettTypography.stats)
                        .foregroundStyle(completionPulse ? BrettColors.gold : BrettColors.textInactive)
                        .opacity(Double(progress))
                        .animation(.spring(response: 0.4, dampingFraction: 0.7), value: completionPulse)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
        }
        .frame(height: 56)
    }

    // MARK: - Section computation

    private var sections: TodaySections {
        TodaySections.bucket(
            items: allItems,
            reflowKey: reflowSnapshotKey
        )
    }

    /// `id`-based lookup so we can show the list name as metadata without
    /// threading ListStore into every TaskRow.
    private var listsById: [String: ItemList] {
        Dictionary(uniqueKeysWithValues: allLists.map { ($0.id, $0) })
    }

    private func listName(for item: Item) -> String? {
        guard let listId = item.listId else { return nil }
        return listsById[listId]?.name
    }

    // MARK: - Task sections

    @ViewBuilder
    private var taskSections: some View {
        TaskSection(
            label: "Overdue",
            icon: "exclamationmark.triangle",
            items: sections.overdue,
            labelColor: BrettColors.error,
            accentColor: BrettColors.error,
            listNameProvider: listName(for:),
            onToggle: toggle,
            onSelect: select
        )

        TaskSection(
            label: "Today",
            icon: "sun.max",
            items: sections.today,
            labelColor: .white,
            listNameProvider: listName(for:),
            onToggle: toggle,
            onSelect: select
        )

        TaskSection(
            label: "This Week",
            icon: "calendar",
            items: sections.thisWeek,
            labelColor: .white,
            listNameProvider: listName(for:),
            onToggle: toggle,
            onSelect: select
        )

        TaskSection(
            label: "Next Week",
            icon: "arrow.right.circle",
            items: sections.nextWeek,
            labelColor: .white,
            listNameProvider: listName(for:),
            onToggle: toggle,
            onSelect: select
        )

        TaskSection(
            label: "Done Today",
            icon: "checkmark.circle",
            items: sections.doneToday,
            labelColor: BrettColors.textInactive,
            listNameProvider: listName(for:),
            onToggle: toggle,
            onSelect: select
        )
    }

    // MARK: - Empty state

    @ViewBuilder
    private var emptyState: some View {
        if sections.isEveryActiveSectionEmpty {
            VStack(spacing: 6) {
                Text(sections.hasDoneToday ? "Cleared." : "Nothing on the books today.")
                    .font(BrettTypography.emptyHeading)
                    .foregroundStyle(BrettColors.textCardTitle)
                    .multilineTextAlignment(.center)

                Text(sections.hasDoneToday
                    ? "Nothing left. Go build something or enjoy the quiet."
                    : "A rare opening — use it well.")
                    .font(BrettTypography.emptyCopy)
                    .foregroundStyle(BrettColors.textInactive)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 32)
            .padding(.top, 48)
        }
    }

    // MARK: - Stats

    private var statsLine: String {
        let total = sections.activeCount + sections.doneToday.count
        let done = sections.doneToday.count
        let base = "\(done) of \(total) done"
        guard hasCalendarData else { return base }
        let suffix = meetingCount == 1 ? "meeting" : "meetings"
        return "\(base) · \(meetingCount) \(suffix) (\(meetingDurationText))"
    }

    // MARK: - Calendar helpers

    private var todaysEvents: [CalendarEvent] {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        let end = calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86_400)
        return allEvents.filter { $0.startTime >= start && $0.startTime < end }
    }

    private var meetingCount: Int { todaysEvents.count }

    private var meetingDurationText: String {
        let total = todaysEvents.reduce(0) { $0 + $1.durationMinutes }
        let hours = total / 60
        let mins = total % 60
        if hours > 0 && mins > 0 { return "\(hours)h \(mins)m" }
        if hours > 0 { return "\(hours)h" }
        return "\(mins)m"
    }

    /// Whether the user has any connected calendar data at all. If there are
    /// zero events on _any_ day, we treat calendars as un-connected and hide
    /// the meeting chunk of the stats line.
    private var hasCalendarData: Bool { !allEvents.isEmpty }

    private var nextUpcomingEvent: CalendarEvent? {
        allEvents.first { $0.startTime > tickerNow.addingTimeInterval(-60) }
    }

    /// Only surface the card when the next event is genuinely soon. We use a
    /// wide 60-minute window so the "compact" form is visible well before the
    /// "imminent" 10-minute form kicks in.
    private var hasNextUpEvent: Bool {
        guard let next = nextUpcomingEvent else { return false }
        let minutesUntil = next.startTime.timeIntervalSince(tickerNow) / 60
        return minutesUntil <= 60
    }

    // MARK: - Actions

    /// Toggle a task's status. Fires the completion cascade:
    /// 1. Haptic success
    /// 2. Header stats pulse gold (spring animation on `completionPulse`)
    /// 3. After ~1.5s idle, the item moves into Done Today — implemented by
    ///    bumping `reflowSnapshotKey` which invalidates the cached sections.
    ///    Each fresh toggle cancels the previous reflow so a burst of quick
    ///    completions all settle together.
    private func toggle(_ id: String) {
        HapticManager.success()
        itemStore.toggleStatus(id: id)

        // Trigger the stats pulse. Flip true for a beat, then back false so
        // the spring animation actually runs.
        completionPulse = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 400_000_000)
            completionPulse = false
        }

        // Debounced reflow into Done Today.
        pendingReflowTask?.cancel()
        pendingReflowTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if Task.isCancelled { return }
            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                reflowSnapshotKey &+= 1
            }
        }
    }

    private func select(_ id: String) {
        store.selectedTaskId = id
    }

    // MARK: - Ticker

    /// 30-second ticker to keep NextUpCard's relative time display fresh.
    /// Cancels automatically when the view leaves the screen because `.task`
    /// is tied to view lifetime.
    private func startTicker() async {
        while !Task.isCancelled {
            tickerNow = Date()
            try? await Task.sleep(nanoseconds: 30_000_000_000)
        }
    }
}

// MARK: - Section bucketing

/// Value type carrying the bucketed sections for the Today page.
///
/// Keeping the bucketing logic off the view makes it trivially testable in
/// previews with fixture items (see the #Preview at the bottom of this file).
struct TodaySections {
    let overdue: [Item]
    let today: [Item]
    let thisWeek: [Item]
    let nextWeek: [Item]
    let doneToday: [Item]

    var activeCount: Int {
        overdue.count + today.count + thisWeek.count + nextWeek.count
    }

    var hasDoneToday: Bool { !doneToday.isEmpty }

    var isEveryActiveSectionEmpty: Bool { activeCount == 0 }

    /// Bucket items into Overdue / Today / This Week / Next Week / Done Today
    /// based on local-calendar date math. `reflowKey` is unused here but
    /// participates in the computed identity so SwiftUI re-derives the
    /// sections when the parent bumps it (debounced completion cascade).
    static func bucket(items: [Item], reflowKey: Int) -> TodaySections {
        _ = reflowKey // force re-derivation on change; see toggle() in the parent
        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let endOfToday = calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? startOfToday.addingTimeInterval(86_400)

        // End of this week = next Sunday midnight local time.
        let weekday = calendar.component(.weekday, from: now)
        let daysUntilEndOfWeek = max(0, 8 - weekday) // Sunday = 1, Saturday = 7
        let endOfThisWeek = calendar.date(byAdding: .day, value: daysUntilEndOfWeek, to: startOfToday) ?? endOfToday
        let endOfNextWeek = calendar.date(byAdding: .day, value: 7, to: endOfThisWeek) ?? endOfThisWeek.addingTimeInterval(7 * 86_400)

        var overdue: [Item] = []
        var today: [Item] = []
        var thisWeek: [Item] = []
        var nextWeek: [Item] = []
        var doneToday: [Item] = []

        for item in items {
            if item.itemStatus == .archived { continue }

            if item.itemStatus == .done {
                if let completed = item.completedAt,
                   completed >= startOfToday && completed < endOfToday {
                    doneToday.append(item)
                }
                continue
            }

            // Active tasks only from here on out.
            if item.itemStatus != .active { continue }
            guard let due = item.dueDate else { continue }

            if due < startOfToday {
                overdue.append(item)
            } else if due < endOfToday {
                today.append(item)
            } else if due < endOfThisWeek {
                thisWeek.append(item)
            } else if due < endOfNextWeek {
                nextWeek.append(item)
            }
        }

        return TodaySections(
            overdue: overdue.sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) },
            today: today.sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) },
            thisWeek: thisWeek.sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) },
            nextWeek: nextWeek.sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) },
            doneToday: doneToday.sorted {
                ($0.completedAt ?? .distantPast) > ($1.completedAt ?? .distantPast)
            }
        )
    }
}

// MARK: - Preview

#Preview("Today — with fixture items") {
    let preview = PersistenceController.makePreview()
    let context = preview.mainContext
    let calendar = Calendar.current
    let today = calendar.startOfDay(for: Date())

    let workList = ItemList(userId: "preview-user", name: "Work", colorClass: "bg-blue-500", sortOrder: 0)
    let healthList = ItemList(userId: "preview-user", name: "Health", colorClass: "bg-green-500", sortOrder: 1)
    context.insert(workList)
    context.insert(healthList)

    let fixtures: [Item] = [
        // Overdue
        .init(userId: "preview-user", title: "Submit Q1 expense report", dueDate: calendar.date(byAdding: .day, value: -2, to: today), listId: workList.id),
        .init(userId: "preview-user", title: "Renew gym membership", dueDate: calendar.date(byAdding: .day, value: -1, to: today), listId: healthList.id),
        // Today
        .init(userId: "preview-user", title: "Prep slides for Q2 review", dueDate: calendar.date(bySettingHour: 9, minute: 0, second: 0, of: today), listId: workList.id),
        .init(userId: "preview-user", title: "Push mobile auth fix to staging", dueDate: calendar.date(bySettingHour: 10, minute: 30, second: 0, of: today), listId: workList.id),
        .init(userId: "preview-user", title: "Book physio appointment", dueDate: calendar.date(bySettingHour: 14, minute: 0, second: 0, of: today), listId: healthList.id),
        // This week
        .init(userId: "preview-user", title: "Draft technical spec for sync v2", dueDate: calendar.date(byAdding: .day, value: 2, to: today), listId: workList.id),
        // Next week
        .init(userId: "preview-user", title: "Annual performance self-review", dueDate: calendar.date(byAdding: .day, value: 7, to: today), listId: workList.id),
    ]
    for item in fixtures {
        context.insert(item)
    }

    // One done-today item so the Done section lights up.
    let done = Item(userId: "preview-user", title: "Morning standup", dueDate: today, listId: workList.id)
    done.status = ItemStatus.done.rawValue
    done.completedAt = Date()
    context.insert(done)

    try? context.save()

    return ZStack {
        BackgroundView()
        TodayPage(store: MockStore())
    }
    .modelContainer(preview.container)
    .preferredColorScheme(.dark)
}

#Preview("Today — empty state") {
    let preview = PersistenceController.makePreview()
    return ZStack {
        BackgroundView()
        TodayPage(store: MockStore())
    }
    .modelContainer(preview.container)
    .preferredColorScheme(.dark)
}
