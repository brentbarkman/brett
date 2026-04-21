import SwiftData
import SwiftUI

// MARK: - Navigation value types

enum NavDestination: Hashable {
    case settings
    case scoutsRoster
    case scoutDetail(id: String)
    case eventDetail(id: String)
    case listView(id: String)
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
    @State private var selection = SelectionStore.shared
    /// 0=Lists, 1=Inbox, 2=Today, 3=Calendar. Default is Today (2) so the
    /// app opens to the same primary surface as the desktop. Watch out:
    /// the omnibar's date-injection logic depends on these indices —
    /// search for `currentPage` consumers if you re-order.
    @State private var currentPage = 2
    @State private var path = NavigationPath()
    @State private var showSearch = false
    @State private var showFeedback = false

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

    @State private var kenBurnsScale: CGFloat = Awakening.sessionPlayed ? 1.0 : Awakening.startScale
    @State private var coverOpacity: Double = Awakening.sessionPlayed ? 0.0 : 1.0
    @State private var awakeningTriggered: Bool = Awakening.sessionPlayed

    private let pages = ["Lists", "Inbox", "Today", "Calendar"]

    var body: some View {
        // Tint the whole stack gold so default toolbar items (back
        // buttons, trailing buttons) match the brand without each
        // screen having to override per-item tints.
        NavigationStack(path: $path) {
            ZStack {
                BackgroundView()
                    .scaleEffect(kenBurnsScale, anchor: .center)

                // Shake detection is now handled by `ShakeMonitor.shared`
                // which polls CoreMotion at the app level — no in-tree
                // detector needed. The `.onShake` modifier below still
                // works; it just subscribes to the monitor's
                // notification.

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
                            showSearch = true
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
                case .scoutsRoster:
                    ScoutsRosterView()
                case .scoutDetail(let id):
                    ScoutDetailView(scoutId: id)
                case .eventDetail(let id):
                    EventDetailView(eventId: id)
                case .listView(let id):
                    ListView(listId: id)
                }
            }
            // Task detail as a near-full-screen sheet. Driven by the
            // app-wide `SelectionStore` — any row tap across the app
            // writes `selection.selectedTaskId = id` to present this.
            .sheet(isPresented: Binding(
                get: { selection.selectedTaskId != nil },
                set: { if !$0 { selection.selectedTaskId = nil } }
            )) {
                if let taskId = selection.selectedTaskId {
                    TaskDetailView(itemId: taskId)
                        .presentationDetents([.large])
                        .presentationDragIndicator(.visible)
                        .presentationBackground(Color.black.opacity(0.80))
                        .presentationCornerRadius(20)
                }
            }
            // Search sheet — Spotlight-style modal overlay.
            .sheet(isPresented: $showSearch) {
                SearchSheet(store: searchStore) { result in
                    showSearch = false
                    handleSearchSelection(result)
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Color.black.opacity(0.80))
                .presentationCornerRadius(20)
            }
            // Shake-to-report. Mirrors desktop's Cmd+Shift+. shortcut.
            // Sheet opens with the type picker pre-set to Bug.
            .onShake {
                if !showFeedback {
                    HapticManager.medium()
                    showFeedback = true
                }
            }
            .sheet(isPresented: $showFeedback) {
                FeedbackSheet()
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
                    .presentationBackground(Color.black)
                    .presentationCornerRadius(20)
            }
            // Settings deep-link from re-link task taps. `TaskRow`'s Reconnect
            // pill sets `selection.pendingSettingsTab`; we push `.settings`
            // plus the target tab onto the NavigationStack in one shot so the
            // back button returns to the task list, not an empty Settings.
            .onChange(of: selection.pendingSettingsTab) { _, tab in
                guard let tab else { return }
                path.append(NavDestination.settings)
                path.append(tab)
                selection.pendingSettingsTab = nil
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
                selection.selectedTaskId = result.entityId
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
