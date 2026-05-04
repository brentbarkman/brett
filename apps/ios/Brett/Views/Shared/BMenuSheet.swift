import SwiftData
import SwiftUI

/// Bottom sheet behind the gold "B" chip in `ViewPillsBar`. Compresses
/// the four destinations the calm-hero design (2026-05-04 spec) pulls
/// out of the top toolbar — Profile, Scouts, Notifications, Settings —
/// into a single small surface so the top of every page can stay
/// editorial-empty.
///
/// Sized via a custom small detent (~30% of screen) since four short
/// rows don't earn a half-screen sheet. Each tap dismisses the sheet
/// and pushes its destination via `NavStore.shared.go(to:)` so the
/// existing routing pipeline (and its analytics + back-button handling)
/// remains the single source of truth for navigation.
///
/// Auth gate around `BMenuSheetBody`. Same pattern as every other
/// `@Query`-backed view in the app (see `TodayPage`, `InboxPage`,
/// `EditScoutSheetContainer`): the body's predicate captures `userId`
/// directly so the SwiftData fetch is user-scoped at the SQLite level.
/// Without the gate the scout-count subtitle could surface another
/// user's data during a sign-out drain or multi-account switch — the
/// CLAUDE.md "multi-user mindset" rule is non-negotiable here.
struct BMenuSheet: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            BMenuSheetBody(userId: userId)
                .id(userId)
        } else {
            // Signed-out fallback. Upstream auth gate normally prevents
            // this branch — render empty rather than nil-fallback so
            // the type system stays simple.
            EmptyView()
        }
    }
}

private struct BMenuSheetBody: View {
    let userId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager

    /// Live count of active scouts — surfaces "N active" in the row
    /// subtitle so the sheet feels alive instead of static. User-scoped
    /// via the captured `userId` so multi-account scenarios can never
    /// surface another user's count.
    @Query private var scouts: [Scout]

    init(userId: String) {
        self.userId = userId
        let predicate = #Predicate<Scout> { scout in
            scout.deletedAt == nil
                && scout.userId == userId
                && scout.status == "active"
        }
        _scouts = Query(filter: predicate)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Drag indicator handled by `.presentationDragIndicator`,
            // so the sheet content starts with the first row.
            menuRow(
                icon: "person.crop.circle",
                title: profileTitle,
                subtitle: profileSubtitle,
                action: openProfile,
                accessibilityID: "menu.profile"
            )

            divider

            menuRow(
                icon: "antenna.radiowaves.left.and.right",
                title: "Scouts",
                subtitle: scoutSubtitle,
                action: openScouts,
                accessibilityID: "menu.scouts"
            )

            divider

            menuRow(
                icon: "bell",
                title: "Notifications",
                subtitle: "Coming soon",
                action: nil,
                accessibilityID: "menu.notifications"
            )

            divider

            menuRow(
                icon: "gearshape",
                title: "Settings",
                subtitle: nil,
                action: openSettings,
                accessibilityID: "menu.settings"
            )

            Spacer(minLength: 0)
        }
        .padding(.top, 8)
        .frame(maxWidth: .infinity)
    }

    private var divider: some View {
        Rectangle()
            .fill(Color.white.opacity(0.06))
            .frame(height: 0.5)
            .padding(.horizontal, 20)
    }

    @ViewBuilder
    private func menuRow(
        icon: String,
        title: String,
        subtitle: String?,
        action: (() -> Void)?,
        accessibilityID: String
    ) -> some View {
        // Disabled rows render as the same shape but at lower opacity
        // and don't fire on tap. Keeps the visual rhythm of the menu
        // intact without misleading the user about what's tappable.
        let isEnabled = action != nil

        Button {
            guard let action else { return }
            HapticManager.light()
            action()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.white.opacity(isEnabled ? 0.80 : 0.30))
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.white.opacity(isEnabled ? 0.90 : 0.40))

                    if let subtitle {
                        Text(subtitle)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.white.opacity(isEnabled ? 0.50 : 0.25))
                    }
                }

                Spacer()

                if isEnabled {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BrettColors.textGhost)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityIdentifier(accessibilityID)
    }

    // MARK: - Derived copy

    private var profileTitle: String {
        // The user's display name lives in `currentUser.name` per
        // `AuthUser`. Fall back to the email when the name field is
        // blank (newly-signed-up accounts often are).
        if let name = authManager.currentUser?.name, !name.isEmpty {
            return name
        }
        return "Profile"
    }

    private var profileSubtitle: String? {
        authManager.currentUser?.email
    }

    private var scoutSubtitle: String {
        let active = scouts.count
        switch active {
        case 0: return "No active scouts"
        case 1: return "1 active"
        default: return "\(active) active"
        }
    }

    // MARK: - Actions

    /// All actions follow the same shape: dismiss the sheet first so the
    /// system's dismissal animation runs, then push the destination on
    /// the next runloop tick. Pushing while the sheet is still on screen
    /// races the system animation and produces a flicker / sometimes a
    /// silent no-op on iOS 26. The 350ms delay matches `MainContainer`'s
    /// `handleSearchSelection` + `onSelectList` paths so all sheet→push
    /// transitions in the app share one tuned constant.
    private func openProfile() {
        dismiss()
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 350_000_000)
            // Profile lives inside Settings — the dedicated profile
            // tab gives the sheet a single deep-link target without
            // needing a new top-level destination.
            NavStore.shared.go(to: .settingsTab(.profile))
        }
    }

    private func openScouts() {
        dismiss()
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 350_000_000)
            NavStore.shared.go(to: .scoutsRoster)
        }
    }

    private func openSettings() {
        dismiss()
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 350_000_000)
            NavStore.shared.go(to: .settings)
        }
    }
}

#if DEBUG
@MainActor
private struct BMenuSheetPreview: View {
    @State private var isPresented = true
    let preview = PersistenceController.makePreview()
    let auth: AuthManager = {
        let auth = AuthManager()
        auth.injectFakeSession(user: .testUser, token: "preview")
        return auth
    }()

    var body: some View {
        ZStack {
            WashBackground()
            Button("Open menu") { isPresented = true }
                .foregroundStyle(.white)
        }
        .sheet(isPresented: $isPresented) {
            BMenuSheet()
                .presentationDetents([.fraction(0.35)])
                .presentationDragIndicator(.visible)
                .presentationBackground(Color.black.opacity(0.85))
                .presentationCornerRadius(20)
        }
        .environment(auth)
        .modelContainer(preview.container)
        .preferredColorScheme(.dark)
    }
}

#Preview { BMenuSheetPreview() }
#endif
