import SwiftUI

/// Account management: read-only email, export, and delete.
///
/// Delete calls `DELETE /api/auth/delete-user` (bearer auth, no body). The
/// user must type exactly "DELETE" to confirm — matching the desktop client's
/// confirmation UX.
///
/// Export is desktop-only (Electron file-save dialog); we surface a
/// descriptive message here rather than a fake endpoint.
struct AccountSettingsView: View {
    @Bindable var store: UserProfileStore
    @Environment(AuthManager.self) private var authManager

    @State private var confirmText: String = ""
    @State private var showDeleteDialog = false
    @State private var isDeleting = false
    @State private var infoMessage: String?
    @State private var errorMessage: String?

    private let client: APIClient

    init(store: UserProfileStore, client: APIClient = .shared) {
        self.store = store
        self.client = client
    }

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

            if let errorMessage {
                BrettSettingsSection {
                    Text(errorMessage)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.error)
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
                        Text(userId.prefix(8) + "...")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(BrettColors.textSecondary)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
            }

            BrettSettingsSection("Data") {
                Button {
                    infoMessage = "Export is available on the desktop app."
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
                        if isDeleting {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(BrettColors.error)
                        }
                    }
                }
                .disabled(isDeleting)
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
            TextField("Type DELETE", text: $confirmText)
                .textInputAutocapitalization(.characters)
            Button("Cancel", role: .cancel) {
                confirmText = ""
            }
            Button("Delete", role: .destructive) {
                if confirmText.trimmingCharacters(in: .whitespaces).uppercased() == "DELETE" {
                    Task { await deleteAccount() }
                } else {
                    errorMessage = "You must type DELETE to confirm."
                }
                confirmText = ""
            }
        } message: {
            Text("Type 'DELETE' to confirm. This cannot be undone.")
        }
    }

    // MARK: - Network

    private func deleteAccount() async {
        isDeleting = true
        errorMessage = nil
        defer { isDeleting = false }

        do {
            _ = try await client.rawRequest(
                path: "/api/auth/delete-user",
                method: "DELETE"
            )
            // Server confirmed deletion. Clear local state and return to
            // the sign-in screen.
            await authManager.signOut()
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "Couldn't delete account. Please try again."
        }
    }
}
