import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            BackgroundView()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // MARK: - Profile header
                    profileHeader

                    // MARK: - Account
                    VStack(alignment: .leading, spacing: 8) {
                        sectionLabel("ACCOUNT")
                        GlassCard {
                            VStack(spacing: 0) {
                                settingsRow(icon: "person.circle", label: "Profile", detail: "Brent Barkman")
                                settingsRow(icon: "lock.shield", label: "Security", detail: "Password & passkeys")
                            }
                        }
                        .padding(.horizontal, 16)
                    }

                    // MARK: - Integrations
                    VStack(alignment: .leading, spacing: 8) {
                        sectionLabel("INTEGRATIONS")
                        GlassCard {
                            VStack(spacing: 0) {
                                settingsRow(icon: "calendar", label: "Calendar", detail: "1 account connected", accentColor: BrettColors.success)
                                settingsRow(icon: "cpu", label: "AI Providers", detail: "Anthropic active", accentColor: BrettColors.success)
                                settingsRow(icon: "newspaper", label: "Newsletters", detail: "3 senders")
                            }
                        }
                        .padding(.horizontal, 16)
                    }

                    // MARK: - Preferences
                    VStack(alignment: .leading, spacing: 8) {
                        sectionLabel("PREFERENCES")
                        GlassCard {
                            VStack(spacing: 0) {
                                settingsRow(icon: "paintbrush", label: "Personalize", detail: "Briefing, timezone, background")
                                settingsRow(icon: "bell", label: "Notifications", detail: "Alerts & sounds")
                            }
                        }
                        .padding(.horizontal, 16)
                    }

                    // MARK: - About
                    VStack(alignment: .leading, spacing: 8) {
                        sectionLabel("APP")
                        GlassCard {
                            VStack(spacing: 0) {
                                settingsRow(icon: "info.circle", label: "About", detail: "Version 1.0.0")
                            }
                        }
                        .padding(.horizontal, 16)
                    }

                    // MARK: - Sign Out
                    signOutSection

                    // MARK: - Danger Zone
                    dangerZone

                    Spacer(minLength: 40)
                }
                .padding(.top, 12)
            }
            .scrollIndicators(.hidden)
        }
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Back")
                            .font(.system(size: 16, weight: .medium))
                    }
                    .foregroundStyle(BrettColors.gold)
                }
            }
        }
    }

    // MARK: - Profile header

    @ViewBuilder
    private var profileHeader: some View {
        HStack(spacing: 16) {
            // Avatar
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [BrettColors.gold.opacity(0.40), BrettColors.cerulean.opacity(0.30)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 56, height: 56)

                Text("B")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text("Brent Barkman")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)

                Text("brent@usebrett.com")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
            }

            Spacer()
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Section label helper

    @ViewBuilder
    private func sectionLabel(_ title: String, color: Color = BrettColors.sectionLabelColor) -> some View {
        Text(title)
            .font(BrettTypography.sectionLabel)
            .tracking(2.4)
            .foregroundStyle(color)
            .padding(.horizontal, 20)
    }

    // MARK: - Row

    @ViewBuilder
    private func settingsRow(
        icon: String,
        label: String,
        detail: String? = nil,
        accentColor: Color? = nil,
        isDestructive: Bool = false
    ) -> some View {
        HStack(spacing: 12) {
            // Icon in tinted circle
            ZStack {
                Circle()
                    .fill((isDestructive ? BrettColors.error : BrettColors.gold).opacity(0.10))
                    .frame(width: 32, height: 32)

                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(isDestructive ? BrettColors.error : BrettColors.gold)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(BrettTypography.taskTitle)
                    .foregroundStyle(isDestructive ? BrettColors.error : BrettColors.textCardTitle)

                if let detail {
                    HStack(spacing: 4) {
                        if let accentColor {
                            Circle()
                                .fill(accentColor)
                                .frame(width: 5, height: 5)
                        }
                        Text(detail)
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)
                    }
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(BrettColors.textGhost)
        }
        .padding(.vertical, 6)
    }

    // MARK: - Sign Out

    @ViewBuilder
    private var signOutSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            GlassCard {
                Button {} label: {
                    HStack {
                        Spacer()
                        Text("Sign Out")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Danger Zone

    @ViewBuilder
    private var dangerZone: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("DANGER ZONE")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(BrettColors.error.opacity(0.60))
                .padding(.horizontal, 20)

            VStack(spacing: 0) {
                Text("Permanently delete your account and all data. This action cannot be undone.")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 12)

                Button {} label: {
                    HStack {
                        Spacer()
                        Text("Delete Account")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(BrettColors.error)
                        Spacer()
                    }
                    .padding(.vertical, 10)
                    .background(BrettColors.error.opacity(0.10), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(BrettColors.error.opacity(0.30), lineWidth: 0.5)
                    }
                }
                .buttonStyle(.plain)
            }
            .padding(16)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.thinMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(BrettColors.error.opacity(0.30), lineWidth: 0.5)
                    }
            }
            .padding(.horizontal, 16)
        }
    }
}
