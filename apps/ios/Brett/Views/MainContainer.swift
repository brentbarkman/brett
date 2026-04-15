import SwiftUI

// MARK: - Navigation value types

enum NavDestination: Hashable {
    case settings
    case scoutsRoster
    case scoutDetail(id: String)
}

struct MainContainer: View {
    @State private var store = MockStore()
    @State private var currentPage = 1 // 0=Inbox, 1=Today, 2=Calendar

    private let pages = ["Inbox", "Today", "Calendar"]

    var body: some View {
        NavigationStack {
            ZStack {
                BackgroundView()

                TabView(selection: $currentPage) {
                    InboxPage(store: store)
                        .tag(0)

                    TodayPage(store: store)
                        .tag(1)

                    CalendarPage(store: store)
                        .tag(2)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
            .safeAreaInset(edge: .top) {
                // Top controls — safeAreaInset handles dynamic island clearance
                HStack {
                    Spacer()
                    PageIndicator(pages: pages, currentIndex: currentPage)
                    Spacer()
                }
                .overlay(alignment: .trailing) {
                    HStack(spacing: 0) {
                        NavigationLink(value: NavDestination.scoutsRoster) {
                            Image(systemName: "antenna.radiowaves.left.and.right")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.55))
                                .frame(width: 40, height: 40)
                                .contentShape(Rectangle())
                        }

                        NavigationLink(value: NavDestination.settings) {
                            Image(systemName: "gearshape")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.55))
                                .frame(width: 40, height: 40)
                                .contentShape(Rectangle())
                        }
                    }
                    .padding(.trailing, 8)
                }
            }
            .overlay(alignment: .bottom) {
                OmnibarView(
                    store: store,
                    placeholder: currentPage == 0 ? "Capture something..." :
                                currentPage == 2 ? "Add an event..." : "Add a task..."
                )
            }
            .navigationDestination(for: NavDestination.self) { destination in
                switch destination {
                case .settings:
                    SettingsView()
                case .scoutsRoster:
                    ScoutsRosterView(store: store)
                case .scoutDetail(let id):
                    ScoutDetailView(store: store, scoutId: id)
                }
            }
            // Task detail as a near-full-screen sheet
            .sheet(isPresented: Binding(
                get: { store.selectedTaskId != nil },
                set: { if !$0 { store.selectedTaskId = nil } }
            )) {
                if let taskId = store.selectedTaskId {
                    TaskDetailView(store: store, itemId: taskId)
                        .presentationDetents([.large])
                        .presentationDragIndicator(.visible)
                        .presentationBackground(Color.black.opacity(0.80))
                        .presentationCornerRadius(20)
                }
            }
        }
    }
}
