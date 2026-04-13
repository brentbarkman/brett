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
                }

                // Scroll fade at top — content dissolves under the page indicator
                VStack {
                    LinearGradient(
                        colors: [Color.clear, Color.clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 0) // Reserve no space, handled by safe area
                    Spacer()
                }

                // Omnibar overlay with fade behind it
                VStack {
                    Spacer()

                    // Fade gradient above omnibar so cards dissolve into it
                    LinearGradient(
                        colors: [Color.clear, Color.black.opacity(0.6)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 50)
                    .allowsHitTesting(false)

                    OmnibarView(
                        store: store,
                        placeholder: currentPage == 0 ? "Capture something..." :
                                    currentPage == 2 ? "Add an event..." : "Add a task..."
                    )
                    .padding(.bottom, 4)
                    .background {
                        // Solid backing behind omnibar area
                        Color.black.opacity(0.3)
                            .blur(radius: 20)
                    }
                }
                .ignoresSafeArea(edges: .bottom)
            }
        }
    }
}
