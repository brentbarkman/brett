import SwiftUI

// MARK: - Navigation value types

enum NavDestination: Hashable {
    case settings
    case scoutsRoster
    case scoutDetail(id: String)
    case eventDetail(id: String)
    case listView(id: String)
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

    private let pages = ["Lists", "Inbox", "Today", "Calendar"]

    var body: some View {
        // Tint the whole stack gold so default toolbar items (back
        // buttons, trailing buttons) match the brand without each
        // screen having to override per-item tints.
        NavigationStack(path: $path) {
            ZStack {
                BackgroundView()

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
        }
        // Brand tint on the NavigationStack so default toolbar items
        // (the iOS back chevron on ListView / ScoutsRosterView /
        // ScoutDetailView) render in gold instead of system blue.
        .tint(BrettColors.gold)
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
