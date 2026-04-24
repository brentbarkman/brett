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

    /// 0 or 1 row. Used to distinguish "empty because the user has
    /// nothing" from "empty because the first sync hasn't landed yet" —
    /// the latter case shows a skeleton placeholder instead of the
    /// empty-state copy so the page doesn't briefly declare inbox-zero
    /// during startup.
    @Query private var syncHealthRows: [SyncHealth]

    private var hasCompletedInitialSync: Bool {
        syncHealthRows.first?.lastSuccessfulPullAt != nil
    }

    // MARK: - UI state

    @State private var completionPulse: Bool = false
    @State private var pendingReflowTask: Task<Void, Never>? = nil
    /// Snapshot of the active item set at the moment of last completion. When
    /// the debounce window expires we bring the view's "working set" in line
    /// with the live data and the completed items slide into Done.
    @State private var reflowSnapshotKey: Int = 0

    /// Item IDs that were just marked done but should visually stay in
    /// their original section until the debounce window expires. Without
    /// this, completing a task causes the section to immediately re-flow
    /// and the user's next tap lands on the wrong row. Cleared 2s after
    /// the last completion (any new tap resets the clock).
    @State private var pendingDoneIDs: Set<String> = []

    /// Ticker driving NextUpCard's relative-time copy.
    @State private var tickerNow: Date = Date()

    var body: some View {
        // ScrollViewReader so we can scroll the user to the Today section
        // when a new task lands there. Without this, adding a task to a
        // long Today list looks like nothing happened — the row is below
        // the fold.
        ScrollViewReader { proxy in
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
            .onChange(of: SelectionStore.shared.lastCreatedItemId) { _, newId in
                guard newId != nil else { return }
                // Today section is the canonical landing zone for new tasks
                // captured from this page (the omnibar injects dueDate=today
                // when host is currentPage == 2 — Today's tab index after
                // the Lists tab moved to position 0). Scroll to its anchor
                // with a small spring so the user's eye follows the new row.
                withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                    proxy.scrollTo("section_today", anchor: .top)
                }
                // Clear the trigger so subsequent identical creates still
                // fire onChange. (Same id wouldn't otherwise re-trigger.)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                    SelectionStore.shared.lastCreatedItemId = nil
                }
            }
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

    // MARK: - Header

    /// Static page header — was previously a collapsing GeometryReader
    /// that scaled the date from 18pt to 28pt as the user scrolled. The
    /// resize made Today's header look smaller than Inbox's fixed 28pt
    /// header during side-swipes between pages, which the user flagged as
    /// jarring. Now matches the Inbox/Calendar treatment: 28pt date +
    /// muted subtitle, no scroll-driven resize.
    private var collapsingHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(DateHelpers.formatDayHeader(Date()))
                .font(BrettTypography.dateHeader)
                .foregroundStyle(.white)

            Text(statsLine)
                .font(BrettTypography.stats)
                .foregroundStyle(completionPulse ? BrettColors.gold : Color.white.opacity(0.55))
                .animation(.spring(response: 0.4, dampingFraction: 0.7), value: completionPulse)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
    }

    // MARK: - Section computation

    private var sections: TodaySections {
        TodaySections.bucket(
            items: allItems,
            reflowKey: reflowSnapshotKey,
            pendingDoneIDs: pendingDoneIDs
        )
    }

    /// List-name lookup closure that captures the per-list-id index once.
    /// Passed into every `TaskSection` as its `listNameProvider`, so each
    /// row does an O(1) dictionary read instead of triggering a rebuild of
    /// the full `[listId: name]` map per lookup.
    private func makeListNameProvider() -> (Item) -> String? {
        let index = Dictionary(uniqueKeysWithValues: allLists.map { ($0.id, $0.name) })
        return { item in
            guard let listId = item.listId else { return nil }
            return index[listId]
        }
    }

    // MARK: - Task sections

    @ViewBuilder
    private var taskSections: some View {
        // Compute the bucket and list-name lookup once per builder pass
        // so the five section reads share one `TodaySections.bucket(...)`
        // call and every row reuses the same captured lookup closure.
        let s = sections
        let nameProvider = makeListNameProvider()

        TaskSection(
            // Header treatment matches the rest of the Today sections —
            // Electron differentiates "overdue" via per-card urgency
            // styling, not by colouring the section header red. The
            // exclamation icon + "Overdue" word carry enough signal.
            // The red accent bar was iOS-only and the user pushed back
            // on it being noisy.
            label: "Overdue",
            icon: "exclamationmark.triangle",
            items: s.overdue,
            labelColor: .white,
            listNameProvider: nameProvider,
            onToggle: toggle,
            onSelect: select,
            onSchedule: schedule,
            onArchive: archive,
            onDelete: delete
        )

        TaskSection(
            label: "Today",
            icon: "sun.max",
            items: s.today,
            labelColor: .white,
            listNameProvider: nameProvider,
            onToggle: toggle,
            onSelect: select,
            onSchedule: schedule,
            onArchive: archive,
            onDelete: delete
        )

        TaskSection(
            label: "This Week",
            icon: "calendar",
            items: s.thisWeek,
            labelColor: .white,
            listNameProvider: nameProvider,
            onToggle: toggle,
            onSelect: select,
            onSchedule: schedule,
            onArchive: archive,
            onDelete: delete
        )

        TaskSection(
            label: "Next Week",
            icon: "arrow.right.circle",
            items: s.nextWeek,
            labelColor: .white,
            listNameProvider: nameProvider,
            onToggle: toggle,
            onSelect: select,
            onSchedule: schedule,
            onArchive: archive,
            onDelete: delete
        )

        TaskSection(
            label: "Done Today",
            icon: "checkmark.circle",
            items: s.doneToday,
            labelColor: BrettColors.textInactive,
            listNameProvider: nameProvider,
            onToggle: toggle,
            onSelect: select,
            onSchedule: schedule,
            onArchive: archive,
            onDelete: delete
        )
    }

    // MARK: - Empty state

    @ViewBuilder
    private var emptyState: some View {
        // Hoist the bucket so the three `sections.*` reads below share one
        // `TodaySections.bucket(...)` call.
        let s = sections
        if s.isEveryActiveSectionEmpty {
            if hasCompletedInitialSync {
                VStack(spacing: 8) {
                    Text(s.hasDoneToday ? "Cleared." : "Nothing on the books today.")
                        .font(BrettTypography.emptyHeading)
                        .foregroundStyle(Color.white.opacity(0.90))
                        .multilineTextAlignment(.center)

                    Text(s.hasDoneToday
                        ? "Nothing left. Go build something or enjoy the quiet."
                        : "A rare opening — use it well.")
                        .font(BrettTypography.emptyCopy)
                        .foregroundStyle(Color.white.opacity(0.40))
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 32)
                .padding(.top, 48)
            } else {
                // Initial pull hasn't landed — skeleton instead of empty
                // state so we don't flash "Nothing on the books today."
                // before the real data arrives.
                TaskListPlaceholder()
                    .padding(.top, 24)
            }
        }
    }

    // MARK: - Stats

    private var statsLine: String {
        // Hoist the bucket and the day-filtered event list so the three
        // `sections.*` reads share one bucket and the two event accesses
        // (count + duration sum) share one filter pass.
        let s = sections
        let events = todaysEvents
        let total = s.activeCount + s.doneToday.count
        let done = s.doneToday.count
        let base = "\(done) of \(total) done"
        guard !allEvents.isEmpty else { return base }
        let meetingCount = events.count
        let suffix = meetingCount == 1 ? "meeting" : "meetings"
        return "\(base) · \(meetingCount) \(suffix) (\(Self.formatMeetingDuration(events: events)))"
    }

    private static func formatMeetingDuration(events: [CalendarEvent]) -> String {
        let total = events.reduce(0) { $0 + $1.durationMinutes }
        let hours = total / 60
        let mins = total % 60
        if hours > 0 && mins > 0 { return "\(hours)h \(mins)m" }
        if hours > 0 { return "\(hours)h" }
        return "\(mins)m"
    }

    // MARK: - Calendar helpers

    private var todaysEvents: [CalendarEvent] {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        let end = calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86_400)
        return allEvents.filter { $0.startTime >= start && $0.startTime < end }
    }

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
    /// 3. After 2s idle, the item moves into Done Today — implemented by
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

        // Hold the row in its current section until the debounce window
        // expires. The user's `isCompleted` toggle is reflected in the
        // checkbox + strikethrough immediately (TaskRow reads
        // `item.isCompleted` live from SwiftData), but the row doesn't
        // *move* until 2 seconds after the user stops tapping. This
        // prevents the "list jumps and I tap the wrong thing" pattern.
        pendingDoneIDs.insert(id)

        pendingReflowTask?.cancel()
        pendingReflowTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if Task.isCancelled { return }
            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                pendingDoneIDs.removeAll()
                reflowSnapshotKey &+= 1
            }
        }
    }

    private func select(_ id: String) {
        SelectionStore.shared.selectedTaskId = id
    }

    /// Swipe-to-schedule: update dueDate (nil clears it, "Someday").
    /// We snapshot the current value into `previousValues` so the push engine
    /// can field-level merge if the server changed dueDate in the meantime.
    private func schedule(_ id: String, dueDate: Date?) {
        guard let item = itemStore.fetchById(id) else { return }
        HapticManager.medium()
        itemStore.update(
            id: id,
            changes: ["dueDate": dueDate as Any? ?? NSNull()],
            previousValues: ["dueDate": item.dueDate as Any? ?? NSNull()]
        )
    }

    /// Swipe-to-archive: sets status to .archived. Mirrors the desktop's
    /// soft-archive semantics — record stays on the server, hidden from
    /// active views.
    private func archive(_ id: String) {
        guard let item = itemStore.fetchById(id) else { return }
        HapticManager.medium()
        itemStore.update(
            id: id,
            changes: ["status": ItemStatus.archived.rawValue],
            previousValues: ["status": item.status]
        )
    }

    /// Swipe-to-delete: hard delete. ItemStore enqueues a DELETE mutation;
    /// the server treats as soft-delete (sets deletedAt).
    private func delete(_ id: String) {
        HapticManager.heavy()
        itemStore.delete(id: id)
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

    /// Count shown on the iOS home-screen badge and the macOS dock badge.
    /// Overdue + due today + due this week, excluding Next Week, completed,
    /// archived, and items without a due date. Semantically equivalent to
    /// desktop's `activeThingsForCount.length` in `apps/desktop/src/App.tsx`,
    /// but the two can diverge at week boundaries for non-UTC timezones —
    /// desktop uses UTC end-of-week (`getEndOfWeekUTC`) while iOS uses
    /// `Calendar.current` (local time). Matches the existing iOS vs desktop
    /// split in the Today view itself, so the badge stays consistent with
    /// what each client shows on-screen.
    static func badgeCount(items: [Item]) -> Int {
        let s = bucket(items: items, reflowKey: 0)
        return s.overdue.count + s.today.count + s.thisWeek.count
    }

    var hasDoneToday: Bool { !doneToday.isEmpty }

    var isEveryActiveSectionEmpty: Bool { activeCount == 0 }

    /// Bucket items into Overdue / Today / This Week / Next Week / Done Today
    /// based on local-calendar date math. `reflowKey` is unused here but
    /// participates in the computed identity so SwiftUI re-derives the
    /// sections when the parent bumps it (debounced completion cascade).
    /// `pendingDoneIDs` lists items the user just marked done — we keep
    /// them in their original active section until the debounce expires
    /// so the user can keep tapping nearby rows without the list jumping.
    static func bucket(
        items: [Item],
        reflowKey: Int,
        pendingDoneIDs: Set<String> = []
    ) -> TodaySections {
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

            // If this item is being held in its previous section, override
            // its effective status. The TaskRow still reads `isCompleted`
            // from the live model so the checkbox + strikethrough still
            // show as done — only the section assignment is delayed.
            let effectiveStatus: ItemStatus = pendingDoneIDs.contains(item.id) ? .active : item.itemStatus

            if effectiveStatus == .done {
                if let completed = item.completedAt,
                   completed >= startOfToday && completed < endOfToday {
                    doneToday.append(item)
                }
                continue
            }

            // Active tasks only from here on out.
            if effectiveStatus != .active { continue }
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
        TodayPage()
    }
    .modelContainer(preview.container)
    .preferredColorScheme(.dark)
}

#Preview("Today — empty state") {
    let preview = PersistenceController.makePreview()
    return ZStack {
        BackgroundView()
        TodayPage()
    }
    .modelContainer(preview.container)
    .preferredColorScheme(.dark)
}
