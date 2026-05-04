import SwiftData
import SwiftUI

/// Today page — the home screen of the app.
///
/// Auth gate around `TodayPageBody`. The body is the work-doer; this
/// outer view exists only to extract `userId` from the environment and
/// hand it to a child whose `@Query` predicates capture it directly.
///
/// SwiftData's `#Predicate` macro can't read `@Environment` values, so
/// the established workaround is an init-based subview where `userId`
/// is a stored property and each `@Query` is constructed in `init` with
/// the captured user. This pushes the user filter down into the
/// SwiftData fetch instead of doing it in Swift after the fact —
/// cheaper, and keeps cross-user rows from ever entering the working set.
///
/// View identity:
/// `TodayPage` is a thin auth gate — when the user is authenticated it
/// renders `TodayPageBody(userId:)` modified with `.id(userId)`. The
/// `.id(...)` is the load-bearing piece: SwiftUI uses view identity to
/// decide whether to reuse a view's storage or remount fresh, and
/// pinning identity to `userId` guarantees that any future user-swap
/// (multi-account, server-side reassignment, refresh-returning-different-id)
/// triggers a full re-init of `TodayPageBody`'s `@Query` predicates,
/// `@State` stores, and any cached state. Sign-out is also covered for
/// free: `RootView`'s auth gate unmounts `MainContainer` entirely, which
/// destroys the body via the structural path. The `.id` makes that
/// invariant local instead of relying on a multi-component dance.
struct TodayPage: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            TodayPageBody(userId: userId)
                .id(userId)
        } else {
            // Signed-out fallback. The auth gate upstream
            // (`MainContainer`) usually prevents this branch, but render
            // an empty state defensively rather than nil-fallback so the
            // type system doesn't have to model a missing user here.
            EmptyView()
        }
    }
}

/// Today's data + UI. Owned by `TodayPage`'s auth gate, so `userId` is
/// guaranteed non-optional for this view's lifetime. Re-instantiated on
/// account switch because the parent applies `.id(userId)` — SwiftUI
/// treats a changed `id` as a new view identity and remounts this body
/// from scratch, which gives us a fresh `@Query` with the new user's
/// predicate (plus a clean slate for `@State` stores and caches).
private struct TodayPageBody: View {
    let userId: String

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

    /// User-scoped, non-deleted items. Sorted reverse-chronological by
    /// createdAt (the bucketing logic re-sorts inside each section by
    /// the section's own ordering rule). We deliberately do the section
    /// bucketing in Swift rather than five separate `FetchDescriptor`s
    /// so one SwiftData change notification drives the whole view.
    @Query private var items: [Item]
    @Query private var lists: [ItemList]
    @Query private var events: [CalendarEvent]
    /// 0 or 1 row. Used to distinguish "empty because the user has
    /// nothing" from "empty because the first sync hasn't landed yet" —
    /// the latter case shows a skeleton placeholder instead of the
    /// empty-state copy so the page doesn't briefly declare inbox-zero
    /// during startup. NOT user-scoped — `SyncHealth` is a sync-internal
    /// row count that doesn't need cross-user isolation.
    @Query private var syncHealthRows: [SyncHealth]

    init(userId: String) {
        self.userId = userId

        let itemPredicate = #Predicate<Item> { item in
            item.deletedAt == nil && item.userId == userId
        }
        _items = Query(filter: itemPredicate, sort: \Item.createdAt, order: .reverse)

        let listPredicate = #Predicate<ItemList> { list in
            list.deletedAt == nil && list.userId == userId
        }
        _lists = Query(filter: listPredicate, sort: \ItemList.sortOrder)

        // Bound the working set to a ±30-day window. Heavy users sync years
        // of events; without this predicate, every body pass walks the
        // entire history just to compute `nextUpcomingEvent`.
        // The window covers the "next event" ticker (typically minutes/hours
        // away) and any reasonable "next 30 days" peek with comfortable
        // margin. Events whose start is within the window OR whose end is
        // within the window are both included so a long event in progress
        // (started yesterday, ends tomorrow) still surfaces today.
        let calendar = Calendar.current
        let yesterday = calendar.startOfDay(for: Date().addingTimeInterval(-86_400))
        let thirtyDaysOut = calendar.startOfDay(for: Date().addingTimeInterval(86_400 * 30))
        let eventPredicate = #Predicate<CalendarEvent> { event in
            event.deletedAt == nil &&
            event.userId == userId &&
            event.endTime >= yesterday &&
            event.startTime <= thirtyDaysOut
        }
        _events = Query(filter: eventPredicate, sort: \CalendarEvent.startTime)

        // Explicit reassignment to keep parallel structure with the
        // user-scoped queries above. Functionally redundant — the
        // property declaration's default `Query()` is identical — but
        // keeping it makes the init read as a complete inventory of
        // every `@Query` this view owns.
        _syncHealthRows = Query()
    }

    private var hasCompletedInitialSync: Bool {
        syncHealthRows.first?.lastSuccessfulPullAt != nil
    }

    // MARK: - UI state

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
    /// Memo cache for `TodaySections.bucket(...)`. Without it, the
    /// bucket runs on every SwiftUI body re-eval (sync save, scenePhase,
    /// TabView selection, completionPulse, etc.) — a 200-item set
    /// becomes hundreds of date comparisons + 5 sorts per render. The
    /// cache short-circuits when items + reflow + pendingDone are
    /// unchanged, which is the common case for state-only re-renders.
    @State private var sectionsCache = TodaySectionsCache()

    /// Ticker driving NextUpCard's relative-time copy. Only updated when
    /// an event is within the 60-minute card-visibility window — outside
    /// that, the loop in `runTicker()` sleeps adaptively (60s–5 min) and
    /// doesn't write `tickerNow`, so TodayPage's body doesn't re-evaluate.
    /// Without this gating, TabView keeping TodayPage mounted would mean
    /// ~120 wasted body re-evals per hour for any user without an
    /// upcoming meeting.
    @State private var tickerNow: Date = Date()

    var body: some View {
        // ScrollViewReader so we can scroll the user to the Today section
        // when a new task lands there. Without this, adding a task to a
        // long Today list looks like nothing happened — the row is below
        // the fold.
        //
        // Calm-hero layout (2026-05-04 spec):
        //   1. TodayHero — greeting + brief over the photo, no chrome.
        //   2. Photo→wash gradient — 140pt smooth transition into the
        //      solid wash bed that hosts every section below.
        //   3. Wash bed — NextUp + 5 task sections + empty state, all
        //      sitting on `BackgroundService.currentWashColor` so the
        //      photo only lives in the hero zone.
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    // Scroll-offset publisher. A 0pt-tall, transparent
                    // probe sits at the top of the scroll content; its
                    // y-position in the `scroll` coordinate space is
                    // negative when the user has scrolled down, so we
                    // negate it before publishing. `MainContainer` reads
                    // this value to drive the calm-hero adaptive chrome
                    // — the bottom view-pills row stays invisible at
                    // the top of Today and fades in as the hero
                    // scrolls away.
                    GeometryReader { geo in
                        let y = geo.frame(in: .named("scroll")).minY
                        Color.clear
                            .publishHeroScrollOffset(max(0, -y))
                    }
                    .frame(height: 0)

                    // Pass `tickerNow` (the @State managed by `runTicker()`)
                    // rather than a fresh `Date()` per body call so the
                    // hero's date sub-line and `partOfDay` greeting stay
                    // stable across re-renders. The ticker only writes
                    // `tickerNow` when an event is in the visibility
                    // window, so on idle days the value is the page's
                    // mount-time date — fine for a greeting that only
                    // needs to roll over at part-of-day boundaries.
                    TodayHero(briefingStore: briefingStore, date: tickerNow)
                        // The hero owns its own top padding via
                        // `.safeAreaInset` upstream — at this point in
                        // the layout we just want it to claim the top
                        // of the scroll content with a comfortable
                        // editorial bottom margin.

                    // Photo→wash transition. Starts clear at the bottom
                    // of the hero so the photo bleeds into the wash
                    // without a hard line, then arrives at fully opaque
                    // wash 140pt later. Below this gradient the rest of
                    // the page sits on the solid wash.
                    LinearGradient(
                        colors: [Color.clear, BackgroundService.shared.currentWashColor],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 140)

                    // Wash bed. Carries NextUp, the 5 task sections, and
                    // the empty state. Single `.background(washColor)`
                    // here means SwiftUI doesn't restart material chains
                    // per child.
                    VStack(spacing: 0) {
                        if hasNextUpEvent {
                            NextUpCard(event: nextUpcomingEvent, now: tickerNow)
                        }

                        taskSections

                        emptyState
                    }
                    .background(BackgroundService.shared.currentWashColor)
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
                try? await ActiveSession.syncManager?.pullToRefresh()
                await briefingStore.fetch()
            }
            .onChange(of: NavStore.shared.lastCreatedItemId) { _, newId in
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
                    NavStore.shared.lastCreatedItemId = nil
                }
            }
        }
        .task {
            // Initial briefing fetch — only when the user hasn't already
            // dismissed today's and we don't already have one cached.
            if !briefingStore.isDismissedToday && briefingStore.briefing == nil {
                await briefingStore.fetch()
            }
            // Kick off the adaptive ticker for NextUpCard's relative time.
            await runTicker()
        }
    }

    // MARK: - Section computation

    private var sections: TodaySections {
        sectionsCache.sections(
            items: items,
            reflowKey: reflowSnapshotKey,
            pendingDoneIDs: pendingDoneIDs
        )
    }

    /// List-name lookup closure that captures the per-list-id index once.
    /// Passed into every `TaskSection` as its `listNameProvider`, so each
    /// row does an O(1) dictionary read instead of triggering a rebuild of
    /// the full `[listId: name]` map per lookup.
    private func makeListNameProvider() -> (Item) -> String? {
        let index = Dictionary(uniqueKeysWithValues: lists.map { ($0.id, $0.name) })
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

    // MARK: - Calendar helpers

    /// Selection uses live `Date()` (not the @State `tickerNow`) so the
    /// ticker can stay idle without producing stale candidates. The card's
    /// "in N min" copy still reads `tickerNow` for its display string —
    /// the ticker writes a fresh `tickerNow` the moment a candidate enters
    /// range, so the first render after the active/idle transition is
    /// correct.
    private var nextUpcomingEvent: CalendarEvent? {
        let now = Date()
        return events.first {
            $0.startTime > now.addingTimeInterval(-60)
                && $0.myResponseStatus != CalendarRsvpStatus.declined.rawValue
        }
    }

    /// Only surface the card when the next event is genuinely soon. We use a
    /// wide 60-minute window so the "compact" form is visible well before the
    /// "imminent" 10-minute form kicks in. Uses live time for the same
    /// reason `nextUpcomingEvent` does.
    private var hasNextUpEvent: Bool {
        guard let next = nextUpcomingEvent else { return false }
        let minutesUntil = next.startTime.timeIntervalSinceNow / 60
        return minutesUntil <= 60
    }

    // MARK: - Actions

    /// Toggle a task's status. Fires the completion cascade:
    /// 1. Haptic success
    /// 2. After 2s idle, the item moves into Done Today — implemented by
    ///    bumping `reflowSnapshotKey` which invalidates the cached sections.
    ///    Each fresh toggle cancels the previous reflow so a burst of quick
    ///    completions all settle together.
    ///
    /// Calm-hero refactor (2026-05-04) removed the header stats-pulse: the
    /// stats line itself moved out of the page (the editorial hero
    /// doesn't carry a stats counter), so the pulse no longer has a
    /// surface to land on.
    private func toggle(_ id: String) {
        HapticManager.success()
        itemStore.toggleStatus(id: id, userId: userId)

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
        // Wave D Phase 3: single source of truth — `go(to:)`
        // dispatches to `currentDestination` because `.taskDetail`
        // is a sheet-style case.
        NavStore.shared.go(to: .taskDetail(id: id))
    }

    /// Swipe-to-schedule: update dueDate (nil clears it, "Someday").
    /// We snapshot the current value into `previousValues` so the push engine
    /// can field-level merge if the server changed dueDate in the meantime.
    /// The pre-edit row comes from this view's `@Query`-backed `items`
    /// array, which is already user-scoped — no need for a separate store
    /// fetch (those public read methods were removed in Wave B).
    private func schedule(_ id: String, dueDate: Date?) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        HapticManager.medium()
        itemStore.update(
            id: id,
            changes: ["dueDate": dueDate as Any? ?? NSNull()],
            previousValues: ["dueDate": item.dueDate as Any? ?? NSNull()],
            userId: userId
        )
    }

    /// Swipe-to-archive: sets status to .archived. Mirrors the desktop's
    /// soft-archive semantics — record stays on the server, hidden from
    /// active views.
    private func archive(_ id: String) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        HapticManager.medium()
        itemStore.update(
            id: id,
            changes: ["status": ItemStatus.archived.rawValue],
            previousValues: ["status": item.status],
            userId: userId
        )
    }

    /// Swipe-to-delete: hard delete. ItemStore enqueues a DELETE mutation;
    /// the server treats as soft-delete (sets deletedAt).
    private func delete(_ id: String) {
        HapticManager.heavy()
        itemStore.delete(id: id, userId: userId)
    }

    // MARK: - Ticker

    /// Adaptive ticker for `NextUpCard`'s relative-time copy.
    ///
    /// Two modes:
    ///  - **Active** — when the next non-declined event is within the
    ///    card-visibility window (60 min). Updates `tickerNow` every 30s
    ///    so the "in N min" copy refreshes.
    ///  - **Idle** — when no event is within the window. Sleeps without
    ///    writing state (no body re-eval), waking up at most every 5 min
    ///    to re-check whether an event has crept into range. The wake
    ///    interval scales toward "1 minute before the next event would
    ///    enter the window" so the ticker arms itself just in time.
    ///
    /// The `.task` modifier ties this to view lifetime, so when TodayPage
    /// is unmounted (sign-out, account switch via `.id(userId)`) the loop
    /// cancels cleanly. TabView keeps TodayPage mounted across page
    /// swipes, which is why the idle-mode gate matters: without it the
    /// ticker fires 120×/hour even for users with no upcoming meetings.
    private func runTicker() async {
        while !Task.isCancelled {
            let sleepSeconds = Self.nextTickerSleep(secondsUntilNext: nextUpcomingEvent?.startTime.timeIntervalSinceNow)
            try? await Task.sleep(nanoseconds: UInt64(sleepSeconds * 1_000_000_000))
            if Task.isCancelled { return }
            // Refresh AFTER the sleep so the displayed `tickerNow` is
            // always the moment-of-render time, not the moment we
            // started waiting. Only fire the @State write in the
            // active window — idle-mode wakes silently re-poll the
            // gate without triggering a body re-eval.
            //
            // Re-check `nextUpcomingEvent` here (not just rely on the
            // pre-sleep value) because an event could have crossed
            // the boundary while we slept.
            let postSleep = Self.nextTickerSleep(secondsUntilNext: nextUpcomingEvent?.startTime.timeIntervalSinceNow)
            if postSleep == Self.activeTickerInterval {
                tickerNow = Date()
            }
        }
    }

    /// Active-mode tick interval. Card is visible — we want fresh
    /// "in N min" copy on a 30s cadence.
    static let activeTickerInterval: TimeInterval = 30

    /// Pure helper. Given seconds until the next event (or `nil`), returns
    /// the next sleep window:
    ///   - In the visibility window (≤60 min out): 30s active tick
    ///   - Outside the window: sleep until the event would enter range,
    ///     floored at 60s and capped at 5 min so we re-poll periodically
    ///     even when no event is in sight (covers cases where SSE pushes
    ///     a brand-new event into the window between checks).
    /// Exposed so unit tests can verify the cadence math without
    /// constructing a SwiftUI view.
    static func nextTickerSleep(secondsUntilNext: TimeInterval?) -> TimeInterval {
        guard let seconds = secondsUntilNext else { return 300 }
        if seconds <= 3600 { return activeTickerInterval }
        return min(max(seconds - 3600, 60), 300)
    }
}

// MARK: - Preview
//
// The `TodaySections` bucketing logic lives in `TodaySections.swift` so it
// can be unit-tested without this view's SwiftUI dependencies.
//
// Wrapped in `#if DEBUG` because `AuthManager.injectFakeSession` and
// `AuthUser.testUser` are themselves DEBUG-only — without the gate the
// Release build (TestFlight, App Store) fails to compile the preview.
//
// Setup runs in each wrapper's `init()`, NOT inside the `#Preview` macro
// body. Xcode 16's `PreviewMacroBodyBuilder` is a SwiftUI result builder
// that rejects `for` loops and bare-expression statements (e.g.
// `context.insert(...)`, `try? context.save()`). Putting the imperative
// fixture seeding inside a regular `init()` sidesteps the macro entirely
// and gives the preview a clean view tree to render.

#if DEBUG
#Preview("Today — with fixture items") {
    TodayPageFixturePreview()
}

#Preview("Today — empty state") {
    TodayPageEmptyPreview()
}

/// Wrapper view whose `init()` seeds a fixture-rich SwiftData preview
/// container, then renders `TodayPage` against it. The setup is in
/// `init` (a normal function, not a result builder) because the
/// `#Preview` macro body builder rejects the imperative statements
/// the seeding requires — see file-level note above.
@MainActor
private struct TodayPageFixturePreview: View {
    let preview: PersistenceController
    let authManager: AuthManager

    init() {
        let preview = PersistenceController.makePreview()
        let context = preview.mainContext
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())

        // `TodayPage` is an auth gate that reads `userId` from `AuthManager`
        // and pushes it into `TodayPageBody`'s `@Query` predicates. The
        // injected fake session must match the userId on the seeded
        // fixtures or the page falls through to its signed-out
        // `EmptyView()` branch and the preview renders blank.
        let authManager = AuthManager()
        authManager.injectFakeSession(user: .testUser, token: "preview")
        let previewUserId = AuthUser.testUser.id

        let workList = ItemList(userId: previewUserId, name: "Work", colorClass: "bg-blue-500", sortOrder: 0)
        let healthList = ItemList(userId: previewUserId, name: "Health", colorClass: "bg-green-500", sortOrder: 1)
        context.insert(workList)
        context.insert(healthList)

        let fixtures: [Item] = [
            // Overdue
            .init(userId: previewUserId, title: "Submit Q1 expense report", dueDate: calendar.date(byAdding: .day, value: -2, to: today), listId: workList.id),
            .init(userId: previewUserId, title: "Renew gym membership", dueDate: calendar.date(byAdding: .day, value: -1, to: today), listId: healthList.id),
            // Today
            .init(userId: previewUserId, title: "Prep slides for Q2 review", dueDate: calendar.date(bySettingHour: 9, minute: 0, second: 0, of: today), listId: workList.id),
            .init(userId: previewUserId, title: "Push mobile auth fix to staging", dueDate: calendar.date(bySettingHour: 10, minute: 30, second: 0, of: today), listId: workList.id),
            .init(userId: previewUserId, title: "Book physio appointment", dueDate: calendar.date(bySettingHour: 14, minute: 0, second: 0, of: today), listId: healthList.id),
            // This week
            .init(userId: previewUserId, title: "Draft technical spec for sync v2", dueDate: calendar.date(byAdding: .day, value: 2, to: today), listId: workList.id),
            // Next week
            .init(userId: previewUserId, title: "Annual performance self-review", dueDate: calendar.date(byAdding: .day, value: 7, to: today), listId: workList.id),
        ]
        for item in fixtures {
            context.insert(item)
        }

        // One done-today item so the Done section lights up.
        let done = Item(userId: previewUserId, title: "Morning standup", dueDate: today, listId: workList.id)
        done.status = ItemStatus.done.rawValue
        done.completedAt = Date()
        context.insert(done)

        try? context.save()

        self.preview = preview
        self.authManager = authManager
    }

    var body: some View {
        ZStack {
            BackgroundView()
            TodayPage()
        }
        .environment(authManager)
        .modelContainer(preview.container)
        .preferredColorScheme(.dark)
    }
}

/// Sibling of `TodayPageFixturePreview` for the "no items" state. Same
/// init-based pattern so the preview macro body stays clean.
@MainActor
private struct TodayPageEmptyPreview: View {
    let preview: PersistenceController
    let authManager: AuthManager

    init() {
        let preview = PersistenceController.makePreview()
        // Auth gate needs a user even in the empty-state preview;
        // without one TodayPage hits its signed-out EmptyView branch
        // instead of the empty-state copy this preview exists to show.
        let authManager = AuthManager()
        authManager.injectFakeSession(user: .testUser, token: "preview")
        self.preview = preview
        self.authManager = authManager
    }

    var body: some View {
        ZStack {
            BackgroundView()
            TodayPage()
        }
        .environment(authManager)
        .modelContainer(preview.container)
        .preferredColorScheme(.dark)
    }
}
#endif
