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
    @State private var currentPage = 1 // 0=Inbox, 1=Today, 2=Calendar
    @State private var path = NavigationPath()
    @State private var showSearch = false

    private let pages = ["Inbox", "Today", "Calendar"]

    var body: some View {
        NavigationStack(path: $path) {
            ZStack {
                BackgroundView()

                TabView(selection: $currentPage) {
                    InboxPage()
                        .tag(0)

                    TodayPage()
                        .tag(1)

                    CalendarPage()
                        .tag(2)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
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
                    placeholder: currentPage == 0 ? "Capture something..." :
                                currentPage == 2 ? "Add an event..." : "Add a task...",
                    currentPage: currentPage,
                    onSelectList: { id in
                        // Dismiss-then-push: sheet dismissal is already fired by
                        // the drawer. Delay the push a frame so the sheet's
                        // disappear animation doesn't compete with the push.
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
