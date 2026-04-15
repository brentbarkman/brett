import SwiftUI

/// Top-level settings navigation. Uses iOS-native `List` + `Section` with
/// glass materials layered underneath via the `BackgroundView`. Each row is
/// a `NavigationLink` that pushes a dedicated settings screen onto the stack.
///
/// Sign Out is a destructive button at the bottom (not a NavigationLink) so
/// the action fires immediately. Account deletion lives inside the Account
/// screen behind a double-confirm dialog.
struct SettingsView: View {
    @AppStorage("settings.deeplink.tab") private var deepLinkTab: String = ""

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager

    @State private var profileStore = UserProfileStore()
    @State private var listStore = ListStore()

    @State private var showSignOutConfirm = false
    @State private var isSigningOut = false

    var body: some View {
        ZStack {
            BackgroundView()

            List {
                profileHeaderSection
                accountSection
                integrationsSection
                preferencesSection
                listsSection
                systemSection
                signOutSection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .listSectionSpacing(.compact)
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.large)
        .navigationBarBackButtonHidden(false)
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationDestination(for: SettingsTab.self) { tab in
            destination(for: tab)
        }
    }

    @ViewBuilder
    private var profileHeaderSection: some View {
        Section {
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
            .padding(.vertical, 6)
            .listRowBackground(glassRowBackground)
            .listRowSeparator(.hidden)
        }
    }

    @ViewBuilder
    private var accountSection: some View {
        Section {
            NavigationLink(value: SettingsTab.profile) {
                settingsRowLabel(icon: "person.circle", label: "Profile", detail: userName)
            }
            .listRowBackground(glassRowBackground)

            NavigationLink(value: SettingsTab.security) {
                settingsRowLabel(icon: "lock.shield", label: "Security", detail: "Face ID & sessions")
            }
            .listRowBackground(glassRowBackground)

            NavigationLink(value: SettingsTab.account) {
                settingsRowLabel(icon: "person.crop.circle.badge.exclamationmark", label: "Account", detail: "Export, delete")
            }
            .listRowBackground(glassRowBackground)
        } header: {
            sectionHeader("Account")
        }
    }

    @ViewBuilder
    private var integrationsSection: some View {
        Section {
            NavigationLink(value: SettingsTab.calendar) {
                settingsRowLabel(icon: "calendar", label: "Calendar", detail: "Connected accounts")
            }
            .listRowBackground(glassRowBackground)

            NavigationLink(value: SettingsTab.aiProviders) {
                settingsRowLabel(icon: "cpu", label: "AI Providers", detail: "Keys & models")
            }
            .listRowBackground(glassRowBackground)

            NavigationLink(value: SettingsTab.newsletters) {
                settingsRowLabel(icon: "newspaper", label: "Newsletters", detail: "Ingest & senders")
            }
            .listRowBackground(glassRowBackground)
        } header: {
            sectionHeader("Integrations")
        }
    }

    @ViewBuilder
    private var preferencesSection: some View {
        Section {
            NavigationLink(value: SettingsTab.location) {
                settingsRowLabel(
                    icon: "location",
                    label: "Timezone & Location",
                    detail: profileStore.current?.timezone ?? TimeZone.current.identifier
                )
            }
            .listRowBackground(glassRowBackground)
        } header: {
            sectionHeader("Preferences")
        }
    }

    @ViewBuilder
    private var listsSection: some View {
        let count = listStore.fetchAll(includeArchived: true).count

        Section {
            NavigationLink(value: SettingsTab.lists) {
                settingsRowLabel(
                    icon: "list.bullet.rectangle",
                    label: "Lists",
                    detail: count == 1 ? "1 list" : "\(count) lists"
                )
            }
            .listRowBackground(glassRowBackground)
        } header: {
            sectionHeader("Organization")
        }
    }

    @ViewBuilder
    private var systemSection: some View {
        Section {
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
            .padding(.vertical, 2)
            .listRowBackground(glassRowBackground)

            NavigationLink(value: SettingsTab.updates) {
                settingsRowLabel(
                    icon: "arrow.down.circle",
                    label: "About",
                    detail: "Version \(appVersion)"
                )
            }
            .listRowBackground(glassRowBackground)
        } header: {
            sectionHeader("App")
        }
    }

    @ViewBuilder
    private var signOutSection: some View {
        Section {
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
            }
            .disabled(isSigningOut)
            .listRowBackground(glassRowBackground)
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
        .padding(.vertical, 2)
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
    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(BrettTypography.sectionLabel)
            .tracking(2.4)
            .foregroundStyle(BrettColors.sectionLabelColor)
            .padding(.leading, -4)
    }

    private var glassRowBackground: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(.thinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
            )
    }

    @ViewBuilder
    private var avatarCircle: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [BrettColors.gold.opacity(0.40), BrettColors.cerulean.opacity(0.30)],
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
        case "lists": self = .lists
        case "account": self = .account
        case "updates", "about": self = .updates
        default: return nil
        }
    }
}
