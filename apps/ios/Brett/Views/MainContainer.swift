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
    /// Calm-hero "B" menu (2026-05-04 spec) — bottom sheet behind the
    /// gold chip in `ViewPillsBar`. Routed through the unified sheet
    /// presenter so it composes with the other modal destinations.
    case menu

    /// True for cases that should present as a sheet rather than a push.
    /// `MainContainer` reads this to decide which presenter wraps the
    /// destination — `.sheet(item:)` for `true`, the navigation stack
    /// for `false`. Keeping the choice as a property on the enum
    /// avoids scattering routing logic across views.
    var isSheet: Bool {
        switch self {
        case .taskDetail, .search, .newScout, .editScout, .menu:
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
// Cold-launch reveal: on first launch of each app process the wallpaper is
// painted at full scale immediately; the UI (pages + top/bottom chrome)
// fades in over it from opacity 0 → 1. Gated on the caller's readiness
// signal (sync hydrated) with a hard cap so a slow or offline launch
// never strands the user on a chrome-less photo. Plays exactly once per
// process; subsequent MainContainer re-renders skip.
//
// Earlier iterations had the photo do a Ken-Burns zoom-in behind a
// fading black cover. The user's call: the photo is the wallpaper, it
// shouldn't make a grand entrance — it should just BE there. Only the
// UI earns an entrance.

enum Awakening {
    /// Flipped once the reveal has started for this process. Not reset —
    /// a fresh app launch is the only way to see it again. Main-actor
    /// isolated because every reader is a SwiftUI View.
    @MainActor static var sessionPlayed = false

    /// Content fade-in duration — pages, task sections, list rows,
    /// chrome. Fast so the workspace feels available immediately.
    static let contentFadeDuration: Double = 1.0

    /// Hero fade-in duration — the editorial 38pt headers (Today's
    /// greeting + brief, every page-header). Slower than content so
    /// the hero blooms after the workspace lands, drawing the eye to
    /// the editorial layer.
    static let heroFadeDuration: Double = 2.0

    /// Hard cap from mount on how long we hold the UI hidden while
    /// waiting on the readiness signal.
    static let maxWaitSeconds: Double = 2.2
}

/// Shared awakening opacity state. Two values so the workspace can
/// arrive on a fast fade while the hero (editorial header band) arrives
/// on a slower one — the workspace feels usable quickly, then the
/// editorial layer settles in for the calm-hero entrance. Read from
/// `MainContainer` (chrome) and from `TodayHero` /
/// `EditorialPageHeader` (the hero band).
@MainActor
@Observable
final class AwakeningState {
    static let shared = AwakeningState()

    var contentOpacity: Double = Awakening.sessionPlayed ? 1.0 : 0.0
    var heroOpacity: Double = Awakening.sessionPlayed ? 1.0 : 0.0

    private init() {}

    /// Animate both opacities to 1. Idempotent.
    func playReveal() {
        withAnimation(.easeOut(duration: Awakening.contentFadeDuration)) {
            contentOpacity = 1.0
        }
        withAnimation(.easeOut(duration: Awakening.heroFadeDuration)) {
            heroOpacity = 1.0
        }
    }
}

struct MainContainer: View {
    @State private var searchStore = SearchStore()
    @State private var selection = NavStore.shared
    /// 0=Lists, 1=Inbox, 2=Today, 3=Calendar. Default is Today (2) so the
    /// app opens to the same primary surface as the desktop. Watch out:
    /// the omnibar's date-injection logic depends on these indices —
    /// search for `currentPage` consumers if you re-order.
    /// In DEBUG, `-UITEST_START_PAGE=N` overrides the launch page so
    /// the audit harness (and similar one-shot screenshot scripts) can
    /// land on a specific surface without driving navigation gestures.
    @State private var currentPage = MainContainer.initialPage()

    private static func initialPage() -> Int {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let raw = args.first(where: { $0.hasPrefix("-UITEST_START_PAGE=") }),
           let value = Int(raw.dropFirst("-UITEST_START_PAGE=".count)),
           (0...3).contains(value) {
            return value
        }
        #endif
        return 2
    }
    @State private var path = NavigationPath()

    @Environment(AuthManager.self) private var authManager
    /// Drives the warm-open fade-in. We re-run the UI reveal whenever
    /// the app returns from `.background` to `.active`, so coming back
    /// to Brett feels like the same calm-hero entrance every time —
    /// not just on cold launch. `.inactive` (control-center pull,
    /// notification banner) is NOT counted; that would fire the
    /// animation every time a swipe-down happens, which is too noisy.
    @Environment(\.scenePhase) private var scenePhase

    // MARK: - Awakening (cold-launch reveal)
    //
    // On first launch of each app process, the wallpaper paints immediately
    // at full scale; the UI (pages + top/bottom chrome) fades in over it from
    // 0 → 1. Gated on `hasCompletedInitialSync` with a hard cap at
    // `maxWaitSeconds` so a slow / offline launch never leaves the user
    // staring at a chrome-less photo.

    @Query private var syncHealthRows: [SyncHealth]
    private var hasCompletedInitialSync: Bool {
        syncHealthRows.first?.lastSuccessfulPullAt != nil
    }

    // The badge `@Query<Item>` lives in `BadgeRefreshController` (mounted
    // below as a hidden child). That controller's predicate captures the
    // signed-in `userId` so the home-screen badge count can never leak
    // another user's active items during sign-out drains, user-switches,
    // or the brief window between a wipe and the next sync. The previous
    // unscoped @Query here was a cross-user defense gap — see
    // `BadgeRefreshController.swift` for the rationale and pattern.

    /// Reactive read of the shared awakening opacities. The chrome
    /// uses `contentOpacity` (fast fade); `TodayHero` /
    /// `EditorialPageHeader` use `heroOpacity` (slower fade).
    @State private var awakening = AwakeningState.shared
    @State private var awakeningTriggered: Bool = Awakening.sessionPlayed
    /// Tracks whether the app has been backgrounded since the last
    /// `.active` so the warm-reentry replay can fire reliably. iOS
    /// transitions through `.inactive` on the way to/from
    /// `.background`, so a `previous == .background, current ==
    /// .active` check never matches — this flag captures the prior
    /// background state explicitly.
    @State private var wasBackgrounded: Bool = false

    /// Reactive read of the shared hero-scroll state. Writes happen
    /// inside TodayPage via `HeroScrollState.shared.publish(...)` —
    /// reading the offset here causes MainContainer to re-render the
    /// adaptive chrome (pills opacity + omnibar bg opacity).
    @State private var heroScroll = HeroScrollState.shared

    /// Distance over which the pills + omnibar transition between hero
    /// (calm) and work (substantive) modes. Matches the photo→wash
    /// gradient height in `TodayPage` so all the calm-hero affordances
    /// transition together.
    private static let heroFadeDistance: CGFloat = 140

    /// Visibility (0–1) for the bottom view-pills row.
    /// - On Today, ramps from 0 at the top of the hero to 1 at
    ///   `heroFadeDistance` of scroll — pills only earn their place
    ///   once the user is in the working zone.
    /// - On every other page, hidden (0). Calm-hero direction is
    ///   swipe-only navigation between pages; the pills aren't a
    ///   primary affordance, just a "here's where you are when you
    ///   land back on Today" signal.
    private var pillsVisibility: Double {
        guard currentPage == 2 else { return 0 }
        let progress = Double(heroScroll.offset / Self.heroFadeDistance)
        return min(max(progress, 0), 1)
    }

    /// Background opacity for the omnibar. Calm-hero spec: 0.55 at
    /// the top of Today (thinner glass so the photo breathes), 1.0
    /// past the hero (substantive glass against busy lists). Same
    /// adaptive curve as `pillsVisibility` — both anchor on the
    /// 140pt hero fade distance so all calm-hero affordances
    /// transition together. Always 1.0 on non-Today pages.
    private var omnibarBackgroundOpacity: Double {
        guard currentPage == 2 else { return 1 }
        let progress = Double(heroScroll.offset / Self.heroFadeDistance)
        let clamped = min(max(progress, 0), 1)
        // Lerp from 0.55 (hero) to 1.0 (work). Never goes below 0.55
        // even at scroll=0 because the omnibar input is interactive
        // and needs *some* glass plate for the field to read against.
        return 0.55 + (1.0 - 0.55) * clamped
    }

    /// Magnitude of the current pager swipe (0 settled, 1 fully
    /// dragged to an adjacent page).
    @State private var pagerDragProgress: CGFloat = 0
    /// Signed pager swipe progress. Positive = dragging toward a
    /// HIGHER page index, negative toward a LOWER index. Combined
    /// with `currentPage` we can compute "effective page position"
    /// during the swipe and drive a smooth photo↔wash crossfade.
    @State private var pagerSignedDragProgress: CGFloat = 0

    /// Opacity for the global background photo. Crossfades smoothly
    /// to the wash as the user swipes away from Today (and back as
    /// they swipe toward Today). The "effective page" is `currentPage
    /// + signedDragProgress`; how close that is to Today's index (2)
    /// is the photo's visibility. Multiplied by the Today scroll
    /// factor so scrolling past the hero also fades the photo out.
    private var photoOpacity: Double {
        let effectivePage = Double(currentPage) + Double(pagerSignedDragProgress)
        let distanceFromToday = abs(effectivePage - 2)
        let proximityToToday = max(0, 1 - distanceFromToday)
        let scrollFactor = currentPage == 2
            ? 1 - min(max(Double(heroScroll.offset / Self.heroFadeDistance), 0), 1)
            : 1.0
        return proximityToToday * scrollFactor
    }

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
                // Always-on wash backdrop, edge-to-edge. Sits at the
                // very back so the safe-area zones are always covered
                // even during the brief moment a page boots its own
                // content.
                WashBackground()

                // Photo on top of the wash, opacity tied to current
                // page + scroll position + live swipe progress. Lives
                // here (not inside Today) so it can reach the safe-
                // area zones — `PagedSwipeView` gives us live swipe
                // progress so the photo crossfades smoothly during a
                // side-swipe instead of snapping at midpoint.
                BackgroundView()
                    .opacity(photoOpacity)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)

                // Shake detection is handled by `ShakeMonitor.shared` (polls
                // CoreMotion at the app level) and presented by
                // `FeedbackPresenter.shared` (UIWindow-level present so
                // it works over any active sheet). Nothing in-tree.

                // PagedSwipeView replaces TabView(.page) so we get
                // real-time swipe progress — TabView only flips its
                // currentPage at midpoint, which made the photo
                // snap-fade at the swipe midpoint instead of
                // crossfading with the drag. Pages still respect the
                // safe area for their own content layout.
                PagedSwipeView(
                    pageCount: 4,
                    selection: $currentPage,
                    dragProgress: $pagerDragProgress,
                    signedDragProgress: $pagerSignedDragProgress
                ) { idx in
                    switch idx {
                    case 0: AnyView(ListsPage())
                    case 1: AnyView(InboxPage())
                    case 2: AnyView(TodayPage())
                    case 3: AnyView(CalendarPage())
                    default: AnyView(EmptyView())
                    }
                }
                // Pages don't carry their own backgrounds anymore.
                // Their content slides over the GLOBAL wash + photo
                // backdrop above (which crossfades based on signed
                // swipe progress), so what the user sees during a
                // swipe is: UI sliding horizontally on top, photo
                // dissolving to wash underneath. No `.ignoresSafeArea()`
                // here — the pager sits inside safe area, page
                // content respects safe area normally for layout.
                .opacity(awakening.contentOpacity)
            }
            .task { await runAwakeningIfNeeded() }
            .onChange(of: hasCompletedInitialSync) { _, ready in
                if ready && !awakeningTriggered {
                    fireAwakening()
                }
            }
            // Warm re-entry. iOS goes
            //   active → inactive → background    (going to homescreen)
            //   background → inactive → active    (returning)
            // so a literal `previous == .background` check on the
            // immediate transition never matches. Track the prior
            // background state explicitly via `wasBackgrounded` so the
            // resume path only fires after a real background trip
            // (skipping the brief `.inactive` flicker from a
            // notification banner / control-center pull).
            //
            // No awakening replay on warm reentry — without an
            // app-switcher privacy cover overlaying the snap-to-0
            // moment, replaying the cold-launch reveal would visibly
            // flicker the UI to invisible and back on every return.
            // Returning to the app should feel instantaneous; the
            // wallpaper + UI the user left is exactly what they
            // expect to see.
            .onChange(of: scenePhase) { _, current in
                if current == .background {
                    wasBackgrounded = true
                    // Pause wallpaper rotation so the 60s `Task.sleep`
                    // can't count wall-time during suspension and fire
                    // a rotate() the moment iOS resumes the process —
                    // which would crossfade the wallpaper to a
                    // different photo from the same tier right as the
                    // user returns.
                    BackgroundService.shared.pauseRotation()
                    return
                }
                if current == .active && wasBackgrounded {
                    wasBackgrounded = false
                    // Restart with a fresh 60s window so the user gets
                    // a full minute of viewing the same wallpaper after
                    // foregrounding before any rotation kicks in.
                    BackgroundService.shared.resumeRotation()
                }
            }
            // Badge refresh runs in `BadgeRefreshController` mounted below
            // — it owns the user-scoped `@Query<Item>` plus the signature
            // onChange, scenePhase onChange, and cold-launch seed task. The
            // controller is gated on `authManager.currentUser?.id` so its
            // predicate always captures the right user.
            .background {
                if let userId = authManager.currentUser?.id {
                    BadgeRefreshController(userId: userId)
                        .id(userId)
                }
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
            // Polished state UX — status banner stays sticky at the top
            // (covers offline, API-unreachable, and retrying states),
            // toast host sits above the omnibar. Both attach here so every
            // page inside the NavigationStack inherits them.
            .statusBanner()
            .errorToastHost()
            .overlay(alignment: .topTrailing) {
                // Sync indicators float over the top-right corner instead
                // of being hosted in a `safeAreaInset`. The earlier inset
                // pushed every page's content down by ~30pt — which made
                // the editorial 38pt headers (Today's greeting, Inbox /
                // Lists / Calendar page titles) sit much further from
                // the dynamic island than the calm-hero direction wants.
                // Indicators are tiny and infrequently updating, so an
                // overlay over the corner is fine.
                HStack(spacing: 6) {
                    SyncPendingIndicator()
                    SyncStatusIndicator()
                }
                .padding(.trailing, 12)
                .padding(.top, 4)
                .opacity(awakening.contentOpacity)
            }
            .overlay(alignment: .bottom) {
                VStack(spacing: 0) {
                    ViewPillsBar(
                        currentPage: $currentPage,
                        onMenuTap: { selection.currentDestination = .menu },
                        visibility: pillsVisibility
                    )

                    // Omnibar fades out on Calendar but its layout
                    // slot stays reserved — otherwise removing it
                    // would shrink the bottom VStack and snap the
                    // view-pills row down to fill the space, which
                    // reads as a jarring pop. Opacity + hit-testing
                    // gating gives a calm fade in/out instead.
                    OmnibarView(
                        placeholder: omnibarPlaceholder,
                        currentPage: currentPage,
                        backgroundOpacity: omnibarBackgroundOpacity,
                        onSelectList: { id in
                            // Drawer is gone (Lists has its own tab now), but
                            // the callback is still wired so any future entry
                            // point that re-introduces a list picker works.
                            // Defer the push by ~350ms so the sheet dismissal
                            // animation completes before the navigation
                            // transition starts. Structured-Task form (vs.
                            // DispatchQueue.main.asyncAfter) suspends with the
                            // process and uses idiomatic concurrency; SwiftUI
                            // doesn't auto-cancel inline Tasks on unmount but
                            // mutating a detached @State is a no-op.
                            Task { @MainActor in
                                try? await Task.sleep(nanoseconds: 350_000_000)
                                path.append(NavDestination.listView(id: id))
                            }
                        }
                    )
                    .opacity(currentPage == 3 ? 0 : 1)
                    .allowsHitTesting(currentPage != 3)
                    .animation(.easeOut(duration: 0.20), value: currentPage)
                }
                .opacity(awakening.contentOpacity)
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
                case .taskDetail, .search, .newScout, .editScout, .menu:
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
                case .menu:
                    // Calm-hero "B" menu — sized to its content (4
                    // short rows + drag indicator). Background is
                    // `.thinMaterial` so the underlying page bleeds
                    // through softly, matching the calm-hero glass
                    // language. Was 0.40 fraction with a fully-opaque
                    // black sheet — too tall and too solid.
                    BMenuSheet()
                        .presentationDetents([.fraction(0.32)])
                        .presentationDragIndicator(.visible)
                        .presentationBackground(.thinMaterial)
                        .presentationCornerRadius(24)
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
                let drained = queue.count
                for dest in queue {
                    path.append(dest)
                }
                // Drain by length, not by wipe — if a pushed view's
                // `.task` / `.onAppear` calls `selection.go(to:
                // anotherPushDest)` synchronously during the loop, the
                // new destination got APPENDED to the live queue after
                // our snapshot. Removing only the drained prefix lets
                // it survive to the next `.onChange` fire. The prior
                // `pendingPushDestinations = []` form silently dropped
                // any destination written mid-drain.
                if selection.pendingPushDestinations.count >= drained {
                    selection.pendingPushDestinations.removeFirst(drained)
                } else {
                    // Defensive: someone reassigned the array out from
                    // under us. Just clear — losing entries is the
                    // lesser evil vs a crash on out-of-bounds.
                    selection.pendingPushDestinations = []
                }
            }
        }
        // Brand tint on the NavigationStack so default toolbar items
        // (the iOS back chevron on ListView / ScoutsRosterView /
        // ScoutDetailView) render in gold instead of system blue.
        .tint(BrettColors.gold)
        // No cold-launch cover anymore — the photo paints at full alpha
        // immediately and the UI fades in over it via `uiOpacity`
        // attached to the TabView and the top/bottom chrome insets.
    }

    // MARK: - Awakening

    /// Decide whether to play the cold-launch reveal and, if so, arm the
    /// cap timer. The reveal itself fires from `fireAwakening()` — either
    /// from the `.onChange(hasCompletedInitialSync)` observer or from
    /// this timer when the sync is slow / offline. Reduce Motion and a
    /// prior session in this process both short-circuit to the settled
    /// state (uiOpacity = 1).
    private func runAwakeningIfNeeded() async {
        guard !awakeningTriggered else { return }

        if BrettAnimation.isReduceMotionEnabled {
            Awakening.sessionPlayed = true
            awakeningTriggered = true
            awakening.contentOpacity = 1.0
            awakening.heroOpacity = 1.0
            return
        }

        // If sync already landed (cache hit from a prior session), fire
        // almost immediately — one tick so the initial frame paints with
        // the UI at 0 alpha first, so the fade-in is actually visible.
        if hasCompletedInitialSync {
            try? await Task.sleep(for: .milliseconds(50))
            fireAwakening()
            return
        }

        // Cap: don't hold the UI hidden longer than `maxWaitSeconds`
        // from mount. If the `.onChange` observer beats us,
        // `fireAwakening` is a no-op on the second call.
        try? await Task.sleep(for: .seconds(Awakening.maxWaitSeconds))
        if !awakeningTriggered {
            fireAwakening()
        }
    }

    /// Kick off the UI fade-in. Idempotent — safe to call from both the
    /// readiness observer and the cap timer.
    private func fireAwakening() {
        guard !awakeningTriggered else { return }
        Awakening.sessionPlayed = true
        awakeningTriggered = true
        awakening.playReveal()
    }

    /// Per-page omnibar placeholder copy verbatim from the v18 mockup
    /// `placeholders` map — short verb + bolded action object
    /// ("Add or **ask Brett…**" on Today). Rendering of the bold
    /// segment lives inside `OmnibarView`, which splits on the
    /// `**…**` markers. Routing is still task-only (existing
    /// `SmartParser` path); full AI intent parsing lands in a
    /// separate PR.
    private var omnibarPlaceholder: String {
        switch currentPage {
        case 0: return "Add to a **list…**"             // Lists
        case 1: return "Capture or **search inbox…**"   // Inbox
        case 3: return "Add an **event…**"              // Calendar
        default: return "Add or **ask Brett…**"         // Today
        }
    }

    /// Navigate to the correct detail surface for a selected search hit.
    /// Sheet dismissal is async, so we defer the push by ~350ms to avoid
    /// racing the sheet's exit animation. Structured-Task form (vs.
    /// DispatchQueue.main.asyncAfter) for the same reason as `onSelectList`
    /// above — idiomatic concurrency, plays nicely with process suspend.
    private func handleSearchSelection(_ result: SearchResult) {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 350_000_000)
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
