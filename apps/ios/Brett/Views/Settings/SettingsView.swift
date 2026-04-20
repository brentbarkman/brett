import SwiftUI

/// Top-level settings navigation. Uses iOS-native `List` + `Section` with
/// glass materials layered underneath via the `BackgroundView`. Each row is
/// a `NavigationLink` that pushes a dedicated settings screen onto the stack.
///
/// Sign Out is a destructive button at the bottom (not a NavigationLink) so
/// the action fires immediately. Account deletion lives inside the Account
/// screen behind a double-confirm dialog.
struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager

    @State private var profileStore = UserProfileStore()
    @State private var listStore = ListStore()

    @State private var showSignOutConfirm = false
    @State private var isSigningOut = false

    var body: some View {
        // Custom layout — moved off `List` because per-row backgrounds
        // produced floating-capsule rows with awkward gaps between
        // them. iOS Settings groups rows in a single section card with
        // hairlines; that's what `BrettSettingsCard` + `BrettSettingsDivider`
        // give us, with full control over spacing and material.
        BrettSettingsScroll {
            profileHeaderCard

            accountCard
            integrationsCard
            preferencesCard
            organizationCard
            systemCard

            signOutCard
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.large)
        .navigationBarBackButtonHidden(false)
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationDestination(for: SettingsTab.self) { tab in
            destination(for: tab)
        }
    }

    // MARK: - Cards (one per section)

    private var profileHeaderCard: some View {
        BrettSettingsCard {
            HStack(spacing: 14) {
                avatarCircle
                VStack(alignment: .leading, spacing: 2) {
                    Text(userName)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(userEmail)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                }
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
        }
    }

    private var accountCard: some View {
        BrettSettingsSection("Account") {
            navRow(tab: .profile, icon: "person.circle", label: "Profile", detail: userName)
            BrettSettingsDivider()
            navRow(tab: .security, icon: "lock.shield", label: "Security", detail: "Face ID & sessions")
            BrettSettingsDivider()
            navRow(tab: .account, icon: "person.crop.circle.badge.exclamationmark", label: "Account", detail: "Export, delete")
        }
    }

    private var integrationsCard: some View {
        BrettSettingsSection("Integrations") {
            navRow(tab: .calendar, icon: "calendar", label: "Calendar", detail: "Connected accounts")
            BrettSettingsDivider()
            navRow(tab: .aiProviders, icon: "cpu", label: "AI Providers", detail: "Keys & models")
            BrettSettingsDivider()
            navRow(tab: .newsletters, icon: "newspaper", label: "Newsletters", detail: "Ingest & senders")
        }
    }

    private var preferencesCard: some View {
        BrettSettingsSection("Preferences") {
            navRow(
                tab: .location,
                icon: "location",
                label: "Timezone & Location",
                detail: profileStore.current?.timezone ?? TimeZone.current.identifier
            )
            BrettSettingsDivider()
            navRow(
                tab: .background,
                icon: "photo.on.rectangle",
                label: "Background",
                detail: currentBackgroundDisplay
            )
        }
    }

    /// Label shown to the right of the Background row. Mirrors the
    /// desktop — "Smart" when not pinned, the solid color's label when
    /// solid, or the style name + "pinned" suffix for a pinned photo.
    private var currentBackgroundDisplay: String {
        guard let profile = profileStore.current else { return "Smart" }
        let style = BackgroundService.Style(rawValue: profile.backgroundStyle) ?? .photography
        if let pinned = profile.pinnedBackground {
            if pinned.hasPrefix("solid:") {
                let hex = String(pinned.dropFirst("solid:".count))
                if let match = BackgroundService.solidColors.first(where: { $0.hex.caseInsensitiveCompare(hex) == .orderedSame }) {
                    return match.label
                }
                return "Solid"
            }
            return "\(style.display) · Pinned"
        }
        return "\(style.display) · Smart"
    }

    private var organizationCard: some View {
        let count = listStore.fetchAll(includeArchived: true).count
        return BrettSettingsSection("Organization") {
            navRow(
                tab: .lists,
                icon: "list.bullet.rectangle",
                label: "Lists",
                detail: count == 1 ? "1 list" : "\(count) lists"
            )
        }
    }

    private var systemCard: some View {
        BrettSettingsSection("App") {
            // "Import" is desktop-only — render as a static row, no nav.
            HStack(spacing: 12) {
                iconCircle("square.and.arrow.down", destructive: false)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Import")
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(BrettColors.textCardTitle)
                    Text("Desktop only")
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                }
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)

            BrettSettingsDivider()
            navRow(
                tab: .updates,
                icon: "arrow.down.circle",
                label: "About",
                detail: "Version \(appVersion)"
            )
        }
    }

    private var signOutCard: some View {
        BrettSettingsCard {
            Button(role: .destructive) {
                showSignOutConfirm = true
            } label: {
                HStack {
                    Spacer()
                    if isSigningOut {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(BrettColors.error)
                    } else {
                        Text("Sign Out")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(BrettColors.error)
                    }
                    Spacer()
                }
                .padding(.vertical, 14)
            }
            .disabled(isSigningOut)
            .accessibilityIdentifier("settings.signout")
        }
        .confirmationDialog("Sign out of Brett?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) {
                Task { await signOut() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll need to sign in again to access your tasks.")
        }
    }

    /// Tappable row that pushes a settings tab onto the navigation
    /// stack. NavigationLink only auto-adds a disclosure chevron when
    /// it lives inside a List — we render a manual chevron here so the
    /// row reads as navigable in our custom card layout.
    @ViewBuilder
    private func navRow(tab: SettingsTab, icon: String, label: String, detail: String? = nil) -> some View {
        NavigationLink(value: tab) {
            HStack(spacing: 0) {
                settingsRowLabel(icon: icon, label: label, detail: detail)

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.30))
                    .padding(.trailing, 14)
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func destination(for tab: SettingsTab) -> some View {
        switch tab {
        case .profile:
            ProfileSettingsView(store: profileStore)
        case .security:
            SecuritySettingsView()
        case .calendar:
            CalendarSettingsView()
        case .aiProviders:
            AIProviderSettingsView()
        case .newsletters:
            NewsletterSettingsView()
        case .location:
            LocationSettingsView(store: profileStore)
        case .background:
            BackgroundSettingsView(store: profileStore)
        case .lists:
            ListsSettingsView(store: listStore)
        case .account:
            AccountSettingsView(store: profileStore)
        case .updates:
            UpdatesSettingsView()
        }
    }

    @ViewBuilder
    private func settingsRowLabel(icon: String, label: String, detail: String? = nil, destructive: Bool = false) -> some View {
        HStack(spacing: 12) {
            iconCircle(icon, destructive: destructive)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(BrettTypography.taskTitle)
                    .foregroundStyle(destructive ? BrettColors.error : BrettColors.textCardTitle)
                if let detail {
                    Text(detail)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        // Padding lives on the row (not the card) so each row is a
        // proper tap target inside the shared section card. Matches
        // iOS Settings' generous row height — was way too cramped at
        // `padding(.vertical, 2)` once we left Form's auto-sizing.
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func iconCircle(_ icon: String, destructive: Bool) -> some View {
        ZStack {
            Circle()
                .fill((destructive ? BrettColors.error : BrettColors.gold).opacity(0.10))
                .frame(width: 30, height: 30)
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(destructive ? BrettColors.error : BrettColors.gold)
        }
    }

    @ViewBuilder
    private var avatarCircle: some View {
        ZStack {
            Circle()
                .fill(
                    // Monochrome gold fade. Previously gold -> cerulean, but
                    // cerulean is reserved for Brett AI surfaces — a user
                    // avatar shouldn't wear the brand signal.
                    LinearGradient(
                        colors: [BrettColors.gold.opacity(0.45), BrettColors.gold.opacity(0.15)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 52, height: 52)
            Text(avatarInitial)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(.white)
        }
    }

    private var avatarInitial: String {
        let name = userName.trimmingCharacters(in: .whitespaces)
        if let first = name.first {
            return String(first).uppercased()
        }
        return "?"
    }

    private var userName: String {
        profileStore.current?.name
            ?? authManager.currentUser?.name
            ?? authManager.currentUser?.email
            ?? "You"
    }

    private var userEmail: String {
        profileStore.current?.email
            ?? authManager.currentUser?.email
            ?? "—"
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }

    private func signOut() async {
        isSigningOut = true
        await authManager.signOut()
        isSigningOut = false
    }
}

enum SettingsTab: Hashable {
    case profile
    case security
    case calendar
    case aiProviders
    case newsletters
    case location
    case background
    case lists
    case account
    case updates

    /// Matches the desktop's URL hash fragments (`#profile`, `#calendar`, etc.)
    /// so we can share deep-link targets between platforms.
    init?(fragment: String) {
        switch fragment.lowercased() {
        case "profile": self = .profile
        case "security": self = .security
        case "calendar": self = .calendar
        case "ai-providers", "aiproviders": self = .aiProviders
        case "newsletters": self = .newsletters
        case "timezone-location", "location", "timezone": self = .location
        case "background", "wallpaper": self = .background
        case "lists": self = .lists
        case "account": self = .account
        case "updates", "about": self = .updates
        default: return nil
        }
    }
}
