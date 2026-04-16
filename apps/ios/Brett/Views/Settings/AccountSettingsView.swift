import SwiftUI

/// Account management: read-only email, export, and delete.
///
/// Export + delete endpoints don't exist yet on the server. We surface
/// them in the UI so the design stays parity with desktop, but both
/// show a "Coming soon" message rather than firing a fake request.
struct AccountSettingsView: View {
    @Bindable var store: UserProfileStore

    @State private var confirmText: String = ""
    @State private var showDeleteDialog = false
    @State private var infoMessage: String?

    var body: some View {
        BrettSettingsScroll {
            if let infoMessage {
                BrettSettingsSection {
                    Text(infoMessage)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textCardTitle)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                }
            }

            BrettSettingsSection("Account") {
                HStack {
                    Text("Email")
                        .foregroundStyle(BrettColors.textMeta)
                    Spacer()
                    Text(store.current?.email ?? "—")
                        .foregroundStyle(BrettColors.textCardTitle)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

                if let userId = store.current?.id {
                    BrettSettingsDivider()

                    HStack {
                        Text("User ID")
                            .foregroundStyle(BrettColors.textMeta)
                        Spacer()
                        Text(userId.prefix(8) + "…")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(BrettColors.textSecondary)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
            }

            BrettSettingsSection("Data") {
                Button {
                    infoMessage = "Data export is available on desktop. We're adding it to iOS soon."
                } label: {
                    HStack {
                        Image(systemName: "square.and.arrow.up")
                            .foregroundStyle(BrettColors.gold)
                        Text("Export my data")
                            .foregroundStyle(BrettColors.textCardTitle)
                        Spacer()
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }

            BrettSettingsSection("Danger Zone") {
                Button(role: .destructive) {
                    showDeleteDialog = true
                } label: {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(BrettColors.error)
                        Text("Delete account")
                            .foregroundStyle(BrettColors.error)
                        Spacer()
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }

            Text("Account deletion permanently removes your tasks, lists, and settings. This can't be undone.")
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.textMeta)
                .padding(.top, -16)
        }
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .alert("Delete your account?", isPresented: $showDeleteDialog) {
            TextField("Type DELETE MY ACCOUNT", text: $confirmText)
                .textInputAutocapitalization(.characters)
            Button("Cancel", role: .cancel) {
                confirmText = ""
            }
            Button("Delete", role: .destructive) {
                if confirmText.trimmingCharacters(in: .whitespaces).uppercased() == "DELETE MY ACCOUNT" {
                    // Endpoint not implemented yet — surface explanation
                    // instead of pretending to delete.
                    infoMessage = "Account deletion is coming soon. Contact support@brett.app to delete your account now."
                }
                confirmText = ""
            }
        } message: {
            Text("Type 'DELETE MY ACCOUNT' (all caps) to confirm. This cannot be undone.")
        }
    }

}
