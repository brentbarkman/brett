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
        ZStack {
            BackgroundView()

            Form {
                if let infoMessage {
                    Section {
                        Text(infoMessage)
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textCardTitle)
                            .listRowBackground(glassRowBackground)
                    }
                }

                Section {
                    HStack {
                        Text("Email")
                            .foregroundStyle(BrettColors.textMeta)
                        Spacer()
                        Text(store.current?.email ?? "—")
                            .foregroundStyle(BrettColors.textCardTitle)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .listRowBackground(glassRowBackground)

                    if let userId = store.current?.id {
                        HStack {
                            Text("User ID")
                                .foregroundStyle(BrettColors.textMeta)
                            Spacer()
                            Text(userId.prefix(8) + "…")
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(BrettColors.textSecondary)
                        }
                        .listRowBackground(glassRowBackground)
                    }
                } header: {
                    sectionHeader("Account")
                }

                Section {
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
                    .listRowBackground(glassRowBackground)
                } header: {
                    sectionHeader("Data")
                }

                Section {
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
                    .listRowBackground(glassRowBackground)
                } header: {
                    sectionHeader("Danger Zone")
                } footer: {
                    Text("Account deletion permanently removes your tasks, lists, and settings. This can't be undone.")
                        .font(.system(size: 12))
                        .foregroundStyle(BrettColors.textMeta)
                }
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
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

    @ViewBuilder
    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(BrettTypography.sectionLabel)
            .tracking(2.4)
            .foregroundStyle(BrettColors.sectionLabelColor)
    }

    private var glassRowBackground: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(.thinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
            )
    }
}
