import SwiftUI

struct MainContainer: View {
    @State private var store = MockStore()
    @State private var currentPage = 1 // 0=Inbox, 1=Today, 2=Calendar
    @State private var navPath = NavigationPath()

    private let pages = ["Inbox", "Today", "Calendar"]

    // DEBUG: Set to a mock item ID to auto-navigate to task detail on launch
    // Set to nil for normal behavior, or an item ID like "item-3" to test detail view
    private let debugAutoNav: String? = nil

    var body: some View {
        NavigationStack(path: $navPath) {
            ZStack {
                // Living background
                BackgroundView()

                // Content pages
                VStack(spacing: 0) {
                    // Page indicator + settings
                    HStack {
                        Spacer()
                        PageIndicator(pages: pages, currentIndex: currentPage)
                        Spacer()
                    }
                    .overlay(alignment: .trailing) {
                        NavigationLink {
                            SettingsView()
                        } label: {
                            Image(systemName: "gearshape")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.40))
                                .frame(width: 44, height: 44)
                        }
                        .padding(.trailing, 12)
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
            // Navigation destination registered at the NavigationStack level
            .navigationDestination(for: String.self) { itemId in
                TaskDetailView(store: store, itemId: itemId)
            }
            .onAppear {
                if let id = debugAutoNav {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        navPath.append(id)
                    }
                }
            }
        }
    }
}
