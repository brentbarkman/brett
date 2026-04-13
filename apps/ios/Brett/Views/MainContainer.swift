import SwiftUI

struct MainContainer: View {
    @State private var store = MockStore()
    @State private var currentPage = 1 // 0=Inbox, 1=Today, 2=Calendar

    private let pages = ["Inbox", "Today", "Calendar"]

    var body: some View {
        NavigationStack {
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
                                .foregroundStyle(Color.white.opacity(0.4))
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
                    // Reserve space at the bottom for the omnibar — ScrollViews
                    // inside each page will respect this inset automatically
                    .safeAreaInset(edge: .bottom) {
                        VStack(spacing: 0) {
                            // Fade gradient so content dissolves before the omnibar
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
        }
    }
}
