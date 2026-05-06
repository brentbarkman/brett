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
        // Each pill takes an equal share of the screen so the row
        // spans edge-to-edge with the menu chip riding on the right.
        // Mockup spec was `justify-content: center` (pills hugging
        // their content), but on a real iPhone that left a lot of
        // empty space at either end of the row and the small pill
        // text felt under-claimed. Stretching them across keeps the
        // chrome legible at thumb distance and reads as a proper
        // navigation surface rather than a polite group of capsules.
        HStack(spacing: 6) {
            ForEach(Self.pages, id: \.index) { page in
                pill(title: page.title, index: page.index)
                    .frame(maxWidth: .infinity)
            }
            menuChip
                .padding(.leading, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .opacity(visibility)
        .animation(BrettAnimation.respectingReduceMotion(.easeOut(duration: 0.20)), value: visibility)
    }

    /// A single page pill. Mockup `.view-pill` was 11pt weight 500
    /// with 6/12 padding; bumped here to 13pt semibold with 10/16
    /// padding because the device-rendered version of the mockup
    /// felt under-claimed at its native size. The hits stay inside
    /// the pill capsule (we use a Button label so the whole capsule
    /// is the tap target) and the row stretches the pill across an
    /// equal share of the screen via the parent's
    /// `.frame(maxWidth: .infinity)`.
    private func pill(title: String, index: Int) -> some View {
        let isActive = currentPage == index
        return Button {
            HapticManager.light()
            withAnimation(.spring(response: 0.32, dampingFraction: 0.85)) {
                currentPage = index
            }
        } label: {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(isActive ? Color.white : Color.white.opacity(0.78))
                .lineLimit(1)
                // Lets the longest label ("Calendar") squeeze to ~12pt
                // when the four-pill row + B chip share an iPhone-narrow
                // viewport. Without this the pill wraps to two lines and
                // breaks the chrome silhouette. The shrink is barely
                // perceptible because only Calendar uses it.
                .minimumScaleFactor(0.82)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
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
                .font(.system(size: 13, weight: .semibold, design: .serif))
                .tracking(0.2)
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
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
                        .shadow(color: Color.black.opacity(0.20), radius: 6, x: 0, y: 3)
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
