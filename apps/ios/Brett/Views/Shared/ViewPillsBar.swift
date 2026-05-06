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
/// Visual spec mirrors v18 mockup `.view-pills` + `.view-pill` +
/// `.menu-chip` exactly: pills + chip are CENTERED as a single group
/// (justify-content: center), each pill is its own dark-glass capsule,
/// the active pill is gold-tinted glass, and the menu chip is a 26pt
/// gold-gradient circle separated by a 6pt margin from the pills.
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
        // Centered HStack (mockup `justify-content: center`) — pills
        // and menu chip travel as one group. Pills get 4pt gap; menu
        // chip gets a 6pt margin separating it from the pills row.
        HStack(spacing: 4) {
            ForEach(Self.pages, id: \.index) { page in
                pill(title: page.title, index: page.index)
            }
            menuChip
                .padding(.leading, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .opacity(visibility)
        .animation(BrettAnimation.respectingReduceMotion(.easeOut(duration: 0.20)), value: visibility)
    }

    /// A single page pill. Mockup `.view-pill`:
    ///   padding 6px 12px; border-radius 100px;
    ///   background rgba(0,0,0,0.40); blur(16px) saturate(140%);
    ///   border 1px solid rgba(255,255,255,0.12);
    ///   color rgba(255,255,255,0.72); font 11px weight 500.
    /// Active variant swaps to `rgba(199,154,77,0.40)` bg + matching
    /// border + white text.
    private func pill(title: String, index: Int) -> some View {
        let isActive = currentPage == index
        return Button {
            HapticManager.light()
            withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) {
                currentPage = index
            }
        } label: {
            Text(title)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(isActive ? Color.white : Color.white.opacity(0.72))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background {
                    Capsule()
                        .fill(isActive ? BrettColors.mockupGold.opacity(0.40) : Color.black.opacity(0.40))
                        .background(Capsule().fill(.ultraThinMaterial))
                        .overlay {
                            Capsule().strokeBorder(
                                isActive
                                    ? BrettColors.mockupGold.opacity(0.65)
                                    : Color.white.opacity(0.12),
                                lineWidth: 1
                            )
                        }
                }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("nav.pill.\(title.lowercased())")
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    /// Gold gradient disc with a serif "B". Mockup `.menu-chip`:
    ///   width 26; border-radius 50%;
    ///   background linear-gradient(135deg, #c79a4d 0%, #8a5e2c 100%);
    ///   border 1px solid rgba(255,220,180,0.30);
    ///   color #fff; font 10px weight 600;
    ///   box-shadow 0 3px 10px rgba(0,0,0,0.20).
    private var menuChip: some View {
        Button {
            HapticManager.light()
            onMenuTap()
        } label: {
            Text("B")
                .font(.system(size: 10, weight: .semibold, design: .serif))
                .tracking(0.2)
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [BrettColors.mockupGold, BrettColors.mockupGoldDark],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .overlay {
                            Circle().strokeBorder(
                                Color(red: 1.0, green: 0.86, blue: 0.71).opacity(0.30),
                                lineWidth: 1
                            )
                        }
                        .shadow(color: Color.black.opacity(0.20), radius: 5, x: 0, y: 3)
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
