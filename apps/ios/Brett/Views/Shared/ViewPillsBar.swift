import SwiftUI

/// Row of pill buttons for switching between the four primary pages
/// (Lists / Inbox / Today / Calendar) plus a gold "B" chip on the right
/// end that opens the menu sheet (Profile / Scouts / Notifications /
/// Settings).
///
/// Calm-hero design (2026-05-04 spec): replaces the old top-of-screen
/// navigation chrome (page indicator dots, search/scouts/settings
/// buttons). Living above the omnibar instead of at the top frees the
/// status-bar zone for editorial breathing room — Today's hero greeting
/// gets the prime real estate, the workhorse navigation gets a quieter
/// home near the user's thumb.
///
/// Pill order mirrors the underlying `TabView` index order in
/// `MainContainer` (0=Lists, 1=Inbox, 2=Today, 3=Calendar). Tapping a
/// pill drives `currentPage`; the gold-tinted active state tracks
/// whichever page the user is currently on (whether they got there by
/// pill tap or horizontal swipe).
struct ViewPillsBar: View {
    @Binding var currentPage: Int
    let onMenuTap: () -> Void

    /// Opacity for the row + chip. Drives the calm-hero adaptive chrome
    /// rule: at the top of Today the row is invisible (the hero gets
    /// the screen to itself); past the hero it fades to 1. Always 1 on
    /// non-Today pages.
    var visibility: Double = 1

    private static let pages: [(title: String, index: Int)] = [
        ("Lists", 0),
        ("Inbox", 1),
        ("Today", 2),
        ("Calendar", 3),
    ]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Self.pages, id: \.index) { page in
                pill(title: page.title, index: page.index)
            }

            Spacer(minLength: 4)

            menuChip
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .opacity(visibility)
        .animation(.easeOut(duration: 0.20), value: visibility)
    }

    private func pill(title: String, index: Int) -> some View {
        let isActive = currentPage == index
        return Button {
            HapticManager.light()
            withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) {
                currentPage = index
            }
        } label: {
            Text(title)
                .font(.system(size: 12, weight: isActive ? .semibold : .regular))
                .foregroundStyle(isActive ? Color.white : Color.white.opacity(0.45))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background {
                    Capsule()
                        .fill(isActive ? BrettColors.gold.opacity(0.20) : Color.clear)
                        .overlay {
                            Capsule().strokeBorder(
                                isActive ? BrettColors.gold.opacity(0.40) : Color.clear,
                                lineWidth: 0.5
                            )
                        }
                }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("nav.pill.\(title.lowercased())")
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    /// Gold disc with a serif "B" — the calm-hero spec's compressed
    /// home for Profile / Scouts / Notifications / Settings.
    private var menuChip: some View {
        Button {
            HapticManager.light()
            onMenuTap()
        } label: {
            Text("B")
                .font(.system(size: 14, weight: .semibold, design: .serif))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background {
                    Circle()
                        .fill(BrettColors.gold)
                        .overlay {
                            Circle().strokeBorder(Color.white.opacity(0.20), lineWidth: 0.5)
                        }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Brett menu")
        .accessibilityIdentifier("nav.menu")
    }
}

#if DEBUG
@MainActor
private struct ViewPillsBarPreview: View {
    @State private var page = 2

    var body: some View {
        ZStack {
            WashBackground()
            VStack {
                Spacer()
                ViewPillsBar(currentPage: $page, onMenuTap: {})
                    .padding(.bottom, 80)
            }
        }
        .preferredColorScheme(.dark)
    }
}

#Preview { ViewPillsBarPreview() }
#endif
