import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            BackgroundView()

            List {
                Section("Account") {
                    settingsRow(icon: "person.circle", title: "Profile")
                    settingsRow(icon: "lock.shield", title: "Security")
                }
                Section("Integrations") {
                    settingsRow(icon: "calendar", title: "Calendar")
                    settingsRow(icon: "cpu", title: "AI Providers")
                    settingsRow(icon: "newspaper", title: "Newsletters")
                }
                Section("Preferences") {
                    settingsRow(icon: "globe", title: "Timezone & Location")
                    settingsRow(icon: "list.bullet", title: "Lists")
                    settingsRow(icon: "square.and.arrow.down", title: "Import")
                }
                Section("App") {
                    settingsRow(icon: "arrow.triangle.2.circlepath", title: "Updates")
                    settingsRow(icon: "person.badge.minus", title: "Account", isDestructive: true)
                }
            }
            .scrollContentBackground(.hidden)
            .listStyle(.insetGrouped)
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.large)
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

    private func settingsRow(icon: String, title: String, isDestructive: Bool = false) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundStyle(isDestructive ? BrettColors.error : BrettColors.gold)
                .frame(width: 24)

            Text(title)
                .font(BrettTypography.taskTitle)
                .foregroundStyle(isDestructive ? BrettColors.error : BrettColors.textPrimary)
        }
    }
}
