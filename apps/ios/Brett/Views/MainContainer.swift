import SwiftUI

// MARK: - Navigation value types

enum NavDestination: Hashable {
    case settings
    case scoutsRoster
    case scoutDetail(id: String)
    case taskDetail(id: String)
}

struct MainContainer: View {
    @State private var store = MockStore()
    @State private var currentPage = 1 // 0=Inbox, 1=Today, 2=Calendar

    private let pages = ["Inbox", "Today", "Calendar"]

    var body: some View {
        NavigationStack {
            ZStack {
                BackgroundView()

                VStack(spacing: 0) {
                    // Page indicator + nav buttons
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
                                    .foregroundStyle(Color.white.opacity(0.40))
                                    .frame(width: 40, height: 44)
                            }

                            NavigationLink(value: NavDestination.settings) {
                                Image(systemName: "gearshape")
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundStyle(Color.white.opacity(0.40))
                                    .frame(width: 40, height: 44)
                            }
                        }
                        .padding(.trailing, 8)
                    }
                    .padding(.top, 8)

                    // Horizontal paging
                    TabView(selection: $currentPage) {
                        InboxPage(store: store)
                            .tag(0)

                        TodayPage(store: store)
                            .tag(1)

                        CalendarPage(store: store)
                            .tag(2)
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                    .safeAreaInset(edge: .bottom) {
                        VStack(spacing: 0) {
                            LinearGradient(
                                colors: [Color.clear, Color.black.opacity(0.5)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            .frame(height: 30)
                            .allowsHitTesting(false)

                            OmnibarView(
                                store: store,
                                placeholder: currentPage == 0 ? "Capture something..." :
                                            currentPage == 2 ? "Add an event..." : "Add a task..."
                            )
                            .padding(.bottom, 4)
                            .padding(.top, 4)
                        }
                    }
                }
            }
            // Single unified navigation destination handler
            .navigationDestination(for: NavDestination.self) { destination in
                switch destination {
                case .settings:
                    SettingsView()
                case .scoutsRoster:
                    ScoutsRosterView(store: store)
                case .scoutDetail(let id):
                    ScoutDetailView(store: store, scoutId: id)
                case .taskDetail(let id):
                    TaskDetailView(store: store, itemId: id)
                }
            }
        }
    }
}
