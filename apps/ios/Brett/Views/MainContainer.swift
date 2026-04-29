import SwiftData
import SwiftUI

// MARK: - Navigation value types

/// Single source of truth for navigation across the app. Drives both
/// `.sheet(item:)` (modal-style destinations) and
/// `.navigationDestination(for: NavDestination.self)` (push-style
/// destinations). Wave D unified the previous mix of three patterns
/// (push, manual `path.append`, and ad-hoc booleans) into this enum
/// so a single `NavStore.currentDestination` value drives every
/// presentation decision in one place.
enum NavDestination: Hashable {
    // Push-style destinations (drive `.navigationDestination(for:)`).
    case settings
    case settingsTab(SettingsTab)
    case scoutsRoster
    case scoutDetail(id: String)
    case eventDetail(id: String)
    case listView(id: String)

    // Sheet-style destinations (drive `.sheet(item:)`).
    // Note: feedback (shake-to-report) is intentionally NOT a NavDestination.
    // It's presented at the UIWindow level by `FeedbackPresenter` so the
    // sheet works above any other modal (TaskDetailView, SearchSheet,
    // etc.). A SwiftUI `.sheet(item:)` anchored here can't open a second
    // sheet while the first is presented.
    case taskDetail(id: String)
    case search
    case newScout
    case editScout(id: String)

    /// True for cases that should present as a sheet rather than a push.
    /// `MainContainer` reads this to decide which presenter wraps the
    /// destination — `.sheet(item:)` for `true`, the navigation stack
    /// for `false`. Keeping the choice as a property on the enum
    /// avoids scattering routing logic across views.
    var isSheet: Bool {
        switch self {
        case .taskDetail, .search, .newScout, .editScout:
            return true
        case .settings, .settingsTab, .scoutsRoster, .scoutDetail, .eventDetail, .listView:
            return false
        }
    }
}

/// `Identifiable` conformance so `NavDestination` can drive
/// `.sheet(item:)`. The enum is already `Hashable`, and each case is
/// self-identifying for sheet purposes — switching e.g.
/// `.taskDetail(id: A)` to `.taskDetail(id: B)` correctly tears down
/// and re-presents the sheet because the value compares unequal.
extension NavDestination: Identifiable {
    var id: Self { self }
}

// MARK: - Awakening tokens
//
// Cold-launch reveal: on first launch of each app process the wallpaper zooms
// from `startScale` → 1.0 (Ken Burns) while a black cover above the UI fades
// out. Gated on the caller's readiness signal (sync hydrated) with a hard cap
// so a slow or offline launch never strands the user on black. Plays exactly
// once per process; subsequent MainContainer re-renders skip.
//
// Mirrors `apps/desktop/src/hooks/useAwakening.ts` — keep durations in sync
// across platforms so the two clients feel like the same product.

enum Awakening {
    /// Flipped once the reveal has started for this process. Not reset —
    /// a fresh app launch is the only way to see it again. Main-actor
    /// isolated because every reader is a SwiftUI View.
    @MainActor static var sessionPlayed = false

    /// Image scale at mount. Eases to 1.0 over `kenBurnsDuration`.
    static let startScale: CGFloat = 1.15

    /// Ken-Burns zoom-out duration.
    static let kenBurnsDuration: Double = 2.5

    /// Black-cover fade-out duration.
    static let coverFadeDuration: Double = 1.8

    /// Hard cap from mount on how long we hold the cover opaque while
    /// waiting on the readiness signal.
    static let maxWaitSeconds: Double = 2.2
}

struct MainContainer: View {
    @State private var searchStore = SearchStore()
    @State private var selection = NavStore.shared
    /// 0=Lists, 1=Inbox, 2=Today, 3=Calendar. Default is Today (2) so the
    /// app opens to the same primary surface as the desktop. Watch out:
    /// the omnibar's date-injection logic depends on these indices —
    /// search for `currentPage` consumers if you re-order.
    @State private var currentPage = 2
    @State private var path = NavigationPath()

    // MARK: - Awakening (cold-launch reveal)
    //
    // On first launch of each app process, the wallpaper zooms from 1.15 → 1.0
    // (Ken Burns) while a black cover above the UI fades out — so the content
    // hydrates under the cover and the user sees a single, settled image.
    // Gated on `hasCompletedInitialSync` with a hard cap at `maxWaitSeconds`.
    // See `Views/Shared/AwakeningModifier.swift` for the tokens and rationale.

    @Query private var syncHealthRows: [SyncHealth]
    private var hasCompletedInitialSync: Bool {
        syncHealthRows.first?.lastSuccessfulPullAt != nil
    }

    /// Items that could affect the iOS badge — active with a due date.
    ///
    /// Narrower than the prior "all non-deleted items" query because the
    /// badge count only ever counts items in `(overdue, due today, this
    /// week)`, which by definition excludes done/archived/snoozed and
    /// items with no due date. SwiftData fires @Query updates whenever
    /// any matched row changes, including transitions OUT of the result
    /// set (e.g. an active item gets completed → row leaves → @Query
    /// fires → badgeSignature recomputes → badge refresh fires). Items
    /// without a due date never contribute to the badge regardless of
    /// status, so filtering them out is purely a hash-cost optimisation.
    ///
    /// Why this matters: badgeSignature hashes every row in the result
    /// set on every `body` pass. On a power user with hundreds of done
    /// or no-due-date items the prior unbounded query made every TabView
    /// swap cost O(n_total). The narrower predicate caps the iteration
    /// at the active-with-due subset, which is bounded by the user's
    /// open-work load (typically dozens, never hundreds).
    @Query(
        filter: #Predicate<Item> { $0.deletedAt == nil && $0.status == "active" },
        sort: \Item.createdAt,
        order: .reverse
    ) private var allItems: [Item]

    @Environment(\.scenePhase) private var scenePhase

    /// Stable hash that changes whenever something affecting the badge count
    /// changes (id, status, or dueDate on any item). `Item` is an `@Model`
    /// class and not `Equatable`, so we observe this `Int` in `onChange`
    /// rather than `allItems` directly.
    ///
    /// Tradeoff: this is a computed property, so SwiftUI re-evaluates it on
    /// every `body` pass, not only on SwiftData pushes. For a user with
    /// thousands of items the extra cost is still negligible (hashing is
    /// O(n) with a tiny constant), and `onChange(of: badgeSignature)` still
    /// fires only on real changes. Caching in `@State` adds complexity for
    /// no measurable win; if a profile ever shows this hot, revisit then.
    private var badgeSignature: Int {
        var hasher = Hasher()
        for item in allItems {
            hasher.combine(item.id)
            hasher.combine(item.itemStatus)
            hasher.combine(item.dueDate)
        }
        return hasher.finalize()
    }

    @State private var kenBurnsScale: CGFloat = Awakening.sessionPlayed ? 1.0 : Awakening.startScale
    @State private var coverOpacity: Double = Awakening.sessionPlayed ? 0.0 : 1.0
    @State private var awakeningTriggered: Bool = Awakening.sessionPlayed

    private let pages = ["Lists", "Inbox", "Today", "Calendar"]

    var body: some View {
        // `@Bindable` projection so we can pass `$selection.currentDestination`
        // to `.sheet(item:)`. The `@State` wrapper alone gives us a
        // `Binding<NavStore>`, not a sub-binding to a property
        // on the @Observable.
        @Bindable var selection = selection
        // Tint the whole stack gold so default toolbar items (back
        // buttons, trailing buttons) match the brand without each
        // screen having to override per-item tints.
        return NavigationStack(path: $path) {
            ZStack {
                BackgroundView()
                    .scaleEffect(kenBurnsScale, anchor: .center)

                // Shake detection is handled by `ShakeMonitor.shared` (polls
                // CoreMotion at the app level) and presented by
                // `FeedbackPresenter.shared` (UIWindow-level present so
                // it works over any active sheet). Nothing in-tree.

                TabView(selection: $currentPage) {
                    ListsPage()
                        .tag(0)

                    InboxPage()
                        .tag(1)

                    TodayPage()
                        .tag(2)

                    CalendarPage()
                        .tag(3)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
            .task { await runAwakeningIfNeeded() }
            .onChange(of: hasCompletedInitialSync) { _, ready in
                if ready && !awakeningTriggered {
                    fireAwakening()
                }
            }
            // Badge sync — fires on any add, delete, or edit that touches
            // id/status/dueDate. `badgeSignature` is an `Int` (Equatable)
            // that hashes the fields affecting the Today bucket count, so
            // we avoid conforming `Item` to `Equatable`.
            .onChange(of: badgeSignature) { _, _ in
                Task { await BadgeManager.shared.refresh(items: allItems) }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task { await BadgeManager.shared.refresh(items: allItems) }
                }
            }
            .task {
                // Cold-launch badge seed. `onChange(of: badgeSignature)` does
                // not fire for the initial value, so we push once here to cover
                // the case where the item set is already loaded when the view
                // mounts. Uses a separate task from the awakening task above so
                // neither blocks the other.
                await BadgeManager.shared.refresh(items: allItems)
            }
            // Tap-to-dismiss the keyboard. `simultaneousGesture` runs in
            // parallel with TabView's swipe + every button's own tap so
            // this never swallows a real interaction — it only fires on
            // empty-area taps. Sends resignFirstResponder to whatever text
            // field currently has focus (omnibar, chat input, etc.).
            .simultaneousGesture(
                TapGesture().onEnded {
                    UIApplication.shared.sendAction(
                        #selector(UIResponder.resignFirstResponder),
                        to: nil,
                        from: nil,
                        for: nil
                    )
                }
            )
            // Polished state UX — offline banner stays sticky at the top,
            // toast host sits above the omnibar. Both attach here so every
            // page inside the NavigationStack inherits them.
            .offlineBanner()
            .errorToastHost()
            .safeAreaInset(edge: .top) {
                // Top controls — safeAreaInset handles dynamic island clearance
                HStack {
                    Spacer()
                    PageIndicator(pages: pages, currentIndex: currentPage)
                    Spacer()
                }
                .overlay(alignment: .trailing) {
                    HStack(spacing: 6) {
                        // Pending-sync pill — hidden when the queue is empty.
                        SyncPendingIndicator()

                        // Animated dot that reflects SyncManager.state (idle /
                        // pushing / pulling / error).
                        SyncStatusIndicator()

                        Button {
                            selection.currentDestination = .search
                        } label: {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.55))
                                .frame(width: 40, height: 40)
                                .contentShape(Rectangle())
                        }

                        NavigationLink(value: NavDestination.scoutsRoster) {
                            Image(systemName: "antenna.radiowaves.left.and.right")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.55))
                                .frame(width: 40, height: 40)
                                .contentShape(Rectangle())
                        }

                        // Settings gear: using an explicit Button + programmatic
                        // path.append so XCUITest can reliably tap this via
                        // its accessibility identifier. `NavigationLink` inside
                        // a `safeAreaInset` overlay has a known issue where
                        // its tap handler doesn't register from synthesized
                        // coordinate taps on iOS 26+.
                        Button {
                            path.append(NavDestination.settings)
                        } label: {
                            Image(systemName: "gearshape")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.55))
                                .frame(width: 40, height: 40)
                                .contentShape(Rectangle())
                        }
                        .accessibilityIdentifier("nav.settings")
                    }
                    .padding(.trailing, 8)
                }
            }
            .overlay(alignment: .bottom) {
                OmnibarView(
                    placeholder: omnibarPlaceholder,
                    currentPage: currentPage,
                    onSelectList: { id in
                        // Drawer is gone (Lists has its own tab now), but
                        // the callback is still wired so any future entry
                        // point that re-introduces a list picker works.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                            path.append(NavDestination.listView(id: id))
                        }
                    }
                )
            }
            .navigationDestination(for: NavDestination.self) { destination in
                switch destination {
                case .settings:
                    SettingsView()
                case .settingsTab(let tab):
                    // Unified single-step deep-link: pushing
                    // `.settingsTab(.calendar)` lands directly on the
                    // calendar sub-page with `Settings` as the back-button
                    // parent. Avoids the prior two-`path.append` pattern
                    // that left the back button in a half-state.
                    SettingsView(initialTab: tab)
                case .scoutsRoster:
                    ScoutsRosterView()
                case .scoutDetail(let id):
                    ScoutDetailView(scoutId: id)
                case .eventDetail(let id):
                    EventDetailView(eventId: id)
                case .listView(let id):
                    ListView(listId: id)
                case .taskDetail, .search, .newScout, .editScout:
                    // Sheet-style destinations are presented via
                    // `.sheet(item:)` elsewhere on this view; reaching
                    // them through the push stack is a programming error.
                    // Render an `EmptyView` so a miswired `path.append`
                    // is harmless rather than crashing.
                    EmptyView()
                }
            }
            // Unified sheet presenter. Folds the previous separate
            // `.sheet(...)` modifiers (task detail, search) plus the
            // per-child sheets (new scout, edit scout) into this
            // single `.sheet(item:)` driven by
            // `selection.currentDestination`. Any view that wants to
            // present a sheet writes a `NavDestination` here; SwiftUI
            // tears down + re-presents on case change and clears the
            // property when the user dismisses. Per-case presentation
            // modifiers (background opacity, detents) live inside each
            // branch since the cases differ on chrome.
            //
            // Feedback (shake-to-report) is intentionally NOT routed
            // here — `FeedbackPresenter` shows it at the UIWindow
            // level so it works above any other sheet.
            .sheet(item: $selection.currentDestination) { destination in
                switch destination {
                case .taskDetail(let id):
                    TaskDetailView(itemId: id)
                        .presentationDetents([.large])
                        .presentationDragIndicator(.visible)
                        .presentationBackground(Color.black.opacity(0.80))
                        .presentationCornerRadius(20)
                case .search:
                    SearchSheet(store: searchStore) { result in
                        // Clear the destination first so the sheet
                        // dismisses immediately, then route the
                        // selection on the next runloop tick (matches
                        // the prior `showSearch = false` behaviour).
                        selection.currentDestination = nil
                        handleSearchSelection(result)
                    }
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
                    .presentationBackground(Color.black.opacity(0.80))
                    .presentationCornerRadius(20)
                case .newScout:
                    NewScoutSheetContainer()
                        .presentationDetents([.large])
                        .presentationDragIndicator(.visible)
                case .editScout(let id):
                    EditScoutSheetContainer(scoutId: id)
                        .presentationDetents([.large])
                        .presentationDragIndicator(.visible)
                case .settings, .settingsTab, .scoutsRoster, .scoutDetail, .eventDetail, .listView:
                    // Push-style destinations are not sheet-presentable.
                    // Render `EmptyView` so a misrouted sheet drive
                    // doesn't crash; the `isSheet` property on the enum
                    // documents the contract callers should follow.
                    EmptyView()
                }
            }
            // Shake-to-report runs at the UIWindow level via
            // `FeedbackPresenter` (installed from `BrettApp.init`). A
            // SwiftUI `.onShake` + `.sheet` anchored here cannot
            // present while a TaskDetailView / SearchSheet is already
            // up — which is exactly when a user wants to report a bug.
            // The presenter bypasses SwiftUI's sheet anchoring and
            // shows from the topmost view controller.
            //
            // Push-style navigation queue. Call sites that use
            // `selection.go(to:)` with a push-style destination append
            // to `pendingPushDestinations`; we observe the array here,
            // drain it onto the navigation stack, then reset to empty.
            // A queue (rather than a single slot) is what lets two
            // rapid back-to-back pushes both land — `.onChange(of:)`
            // for `Equatable` arrays fires on any append, and the
            // drain runs synchronously before any other observer work.
            .onChange(of: selection.pendingPushDestinations) { _, queue in
                guard !queue.isEmpty else { return }
                for dest in queue {
                    path.append(dest)
                }
                selection.pendingPushDestinations = []
            }
        }
        // Brand tint on the NavigationStack so default toolbar items
        // (the iOS back chevron on ListView / ScoutsRosterView /
        // ScoutDetailView) render in gold instead of system blue.
        .tint(BrettColors.gold)
        // Cold-launch cover. Sits above the whole NavigationStack — including
        // safeAreaInset chrome (page indicator, settings gear) — so the
        // UI reveals as one piece rather than top-toolbar-first.
        // `allowsHitTesting(false)` lets stray taps pass through even if
        // opacity rounding leaves a pixel of alpha.
        .overlay {
            if coverOpacity > 0 {
                Color.black
                    .ignoresSafeArea()
                    .opacity(coverOpacity)
                    .allowsHitTesting(false)
            }
        }
    }

    // MARK: - Awakening

    /// Decide whether to play the cold-launch reveal and, if so, arm the
    /// cap timer. The reveal itself fires from `fireAwakening()` — either
    /// from the `.onChange(hasCompletedInitialSync)` observer or from
    /// this timer when the sync is slow / offline. Reduce Motion and a
    /// prior session in this process both short-circuit to the skipped
    /// state (scale 1, cover opacity 0).
    private func runAwakeningIfNeeded() async {
        guard !awakeningTriggered else { return }

        if BrettAnimation.isReduceMotionEnabled {
            Awakening.sessionPlayed = true
            awakeningTriggered = true
            kenBurnsScale = 1.0
            coverOpacity = 0.0
            return
        }

        // If sync already landed (cache hit from a prior session), fire
        // almost immediately — one tick so the initial frame paints at
        // the start scale first, so the Ken Burns motion is visible.
        if hasCompletedInitialSync {
            try? await Task.sleep(for: .milliseconds(50))
            fireAwakening()
            return
        }

        // Cap: don't hold the cover longer than `maxWaitSeconds` from
        // mount. If the `.onChange` observer beats us, `fireAwakening`
        // is a no-op on the second call.
        try? await Task.sleep(for: .seconds(Awakening.maxWaitSeconds))
        if !awakeningTriggered {
            fireAwakening()
        }
    }

    /// Kick off the zoom-out and cover fade. Idempotent — safe to call
    /// from both the readiness observer and the cap timer.
    private func fireAwakening() {
        guard !awakeningTriggered else { return }
        Awakening.sessionPlayed = true
        awakeningTriggered = true

        withAnimation(.easeOut(duration: Awakening.kenBurnsDuration)) {
            kenBurnsScale = 1.0
        }
        withAnimation(.easeOut(duration: Awakening.coverFadeDuration)) {
            coverOpacity = 0.0
        }
    }

    /// Per-page omnibar placeholder copy. Lists/Inbox use generic capture,
    /// Today gets a task-shaped prompt, Calendar gets an event prompt.
    private var omnibarPlaceholder: String {
        switch currentPage {
        case 0: return "Capture to inbox..."   // Lists tab — same as inbox capture
        case 1: return "Capture something..."  // Inbox
        case 3: return "Add an event..."       // Calendar
        default: return "Add a task..."        // Today
        }
    }

    /// Navigate to the correct detail surface for a selected search hit.
    /// Sheet dismissal is async, so we defer the push one runloop tick to
    /// avoid racing the sheet's exit animation.
    private func handleSearchSelection(_ result: SearchResult) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            switch result.entityType {
            case .item:
                // Wave D Phase 3: single source of truth — the
                // unified sheet presenter reads `currentDestination`,
                // which `go(to:)` sets after switching on `isSheet`.
                selection.go(to: .taskDetail(id: result.entityId))
            case .calendarEvent, .meetingNote:
                path.append(NavDestination.eventDetail(id: result.entityId))
            case .scoutFinding:
                // Findings are presented inside ScoutDetailView; entityId is
                // the finding id, so we route via its parent scout when the
                // metadata surfaces it, otherwise fall back to the roster.
                path.append(NavDestination.scoutsRoster)
            }
        }
    }
}

// MARK: - Scout sheet containers
//
// Tiny wrappers that adapt the existing `NewScoutSheet` /
// `ScoutEditSheet` views (which take onCreate / onSave callbacks) to the
// unified `.sheet(item:)` presenter. Each owns its own `ScoutStore` so
// the network + SwiftData writes that the underlying sheets trigger
// stay self-contained — no need for `MainContainer` to hold scout
// state, and no callback plumbing through `NavStore`.

/// Wraps `NewScoutSheet` so it can be presented from `MainContainer`'s
/// unified sheet without relying on `ScoutsRosterView` to own the
/// `ScoutStore`. The sheet's `onCreate` closure throws on failure; the
/// sheet keeps itself open and renders the error in its review step
/// when it catches. We rethrow here so the sheet sees the failure and
/// don't dismiss — dismissal happens inside the sheet on success only.
private struct NewScoutSheetContainer: View {
    @State private var scoutStore = ScoutStore()

    var body: some View {
        NewScoutSheet { payload in
            do {
                _ = try await scoutStore.create(payload: payload)
            } catch {
                BrettLog.store.error("NewScoutSheet create failed: \(String(describing: error), privacy: .public)")
                throw error
            }
        }
    }
}

/// Wraps `ScoutEditSheet` for the unified sheet presenter. Reads the
/// scout row by id via `@Query` so the sheet can populate its initial
/// values, then hands the patch to the local `ScoutStore` on save —
/// same flow as the prior in-detail-view sheet.
private struct EditScoutSheetContainer: View {
    let scoutId: String

    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            EditScoutSheetBody(userId: userId, scoutId: scoutId)
                .id("\(userId)-\(scoutId)")
        } else {
            // Auth gate upstream usually prevents this; render empty
            // rather than nil-fallback so the type system stays simple.
            EmptyView()
        }
    }
}

private struct EditScoutSheetBody: View {
    let userId: String
    let scoutId: String

    @State private var scoutStore = ScoutStore()
    @Query private var matchedScouts: [Scout]

    init(userId: String, scoutId: String) {
        self.userId = userId
        self.scoutId = scoutId
        let predicate = #Predicate<Scout> { scout in
            scout.id == scoutId && scout.userId == userId
        }
        _matchedScouts = Query(filter: predicate)
    }

    var body: some View {
        if let scout = matchedScouts.first {
            ScoutEditSheet(scout: scout) { patch in
                do {
                    _ = try await scoutStore.update(id: scout.id, changes: patch)
                } catch {
                    // Error surfaces via store; sheet stays open on
                    // failure so the user can retry without losing input.
                }
            }
        } else {
            // Scout vanished (deleted, or row not yet hydrated). Drop
            // the sheet rather than show a half-populated form.
            EmptyView()
        }
    }
}
