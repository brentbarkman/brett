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

    /// Reactive read of the shared hero-scroll state — drives the
    /// editorial parallax/opacity/scale on `TodayHero` per the v18
    /// mockup's `applyTodayVerticalScroll`. Same source the
    /// MainContainer reads from for adaptive chrome, so the hero,
    /// pills, and omnibar bg all transition in lockstep.
    @State private var heroScroll = HeroScrollState.shared

    /// Smoothstep-eased 0–1 progress over a given scroll distance —
    /// matches the mockup's `t * t * (3 - 2 * t)` curve. Linear
    /// progress reads as mechanical at the endpoints; smoothstep
    /// snaps softly to 0/1 and feels the way the mockup does.
    private func heroProgress(over distance: CGFloat) -> Double {
        let raw = Double(min(max(heroScroll.offset / distance, 0), 1))
        return raw * raw * (3 - 2 * raw)
    }
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
                    // Hero takes a fresh `Date()` per body re-eval. We
                    // used to pin this to a `tickerNow` @State driven
                    // by an adaptive ticker loop so the dateline could
                    // show a live clock; the clock was dropped (the
                    // iOS status bar already carries it) and the
                    // ticker came out with it for battery — see the
                    // history of this file. The greeting only depends
                    // on the weekday and the dateline only on the
                    // month/day, so per-render `Date()` is stable for
                    // the whole life of a SwiftUI body pass.
                    TodayHero(briefingStore: briefingStore, date: Date())
                        // Editorial parallax — hero text fades + lifts
                        // + tightens as the user scrolls (matches the
                        // v18 mockup's `applyTodayVerticalScroll`).
                        // Translates 30% faster than scroll so the
                        // hero "leaves quickly" and surfaces the wash
                        // bed underneath. Opacity 1→0 over 200pt of
                        // scroll, scale 1→0.96. Reads from the same
                        // shared HeroScrollState the chrome reads
                        // from — one source of truth for the whole
                        // hero-scroll story.
                        .opacity(1 - heroProgress(over: 200))
                        .scaleEffect(1 - heroProgress(over: 200) * 0.04)
                        .offset(y: -heroScroll.offset * 0.3)
                        // Scroll-offset publisher → HeroScrollState.
                        // Writes through to the shared @Observable
                        // so MainContainer's adaptive chrome reads
                        // reactively without depending on
                        // PreferenceKey propagation through TabView
                        // (which is unreliable when SwiftUI keeps
                        // background pages mounted but layout-skipped).
                        .background(
                            GeometryReader { geo in
                                let y = geo.frame(in: .named("scroll")).minY
                                Color.clear
                                    .onChange(of: y, initial: true) { _, newY in
                                        HeroScrollState.shared.publish(-newY)
                                    }
                            }
                        )

                    // NextUp sits directly under the brief and over
                    // the photo. No wash plate behind it — and no
                    // wash plate behind the work zone below either,
                    // per the v18 mockup which has cards floating
                    // over the photo at rest. The wash is brought in
                    // by `MainContainer`'s `fullScreenWashOpacity`
                    // overlay as the user scrolls past the hero, so
                    // an in-scroll static wash bed would just block
                    // the photo prematurely.
                    if hasNextUpEvent {
                        // `now` is captured at body-eval time. Used
                        // to be a `tickerNow` @State that updated
                        // every 30s when an event was in range; we
                        // removed the ticker for battery and the
                        // card still re-renders frequently enough
                        // (scroll, foreground, item changes) for the
                        // relative-time copy.
                        NextUpCard(event: nextUpcomingEvent, now: Date())
                    }

                    // Work zone. Cards float over the photo at rest;
                    // the global `fullScreenWashOpacity` overlay
                    // (in `MainContainer`) fades the wash in over
                    // the photo as the user scrolls past the hero.
                    // The 400pt tail spacer guarantees the bottom
                    // mask has content to fade against on a short
                    // list so the omnibar zone doesn't paint a hard
                    // line into raw photo.
                    VStack(spacing: 0) {
                        taskSections

                        emptyState

                        Color.clear.frame(height: 400)
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding(.bottom, 0)
                // Inner VStack surfaces more reliably as an accessibility
                // element than the outer ScrollView — XCUITest identifier
                // lookups on ScrollView inconsistently resolve.
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("today.page")
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .coordinateSpace(name: "scroll")
            // Bottom fade per v18 mockup `.page { mask-image:
            // linear-gradient(to bottom, black 0, black calc(100% -
            // 110px), transparent calc(100% - 30px)) }`. Page
            // content fades to clear over the bottom 80pt so it
            // disappears gracefully into the omnibar zone instead
            // of crashing into it as a hard line. Safe to use now —
            // the full-screen wash overlay (in MainContainer) covers
            // the underlying photo, so the mask reveals wash, not
            // photo.
            .mask {
                LinearGradient(
                    stops: [
                        .init(color: .black, location: 0),
                        .init(color: .black, location: 0.86),
                        .init(color: .clear, location: 1.0),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
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
