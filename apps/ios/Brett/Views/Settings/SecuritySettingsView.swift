import SwiftUI
import LocalAuthentication

/// Security preferences: Face ID app-lock, sign-in method info, and password
/// change (for email/password accounts).
///
/// On appear we call `GET /api/auth/list-accounts` to determine the sign-in
/// method. If the account uses email/password ("credential"), we show a
/// password change form. If it uses Google, we show a read-only badge instead.
struct SecuritySettingsView: View {
    @AppStorage("security.faceid.enabled") private var faceIDEnabled: Bool = false
    @State private var biometryAvailable: Bool = LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    @State private var biometryType: String = SecuritySettingsView.resolveBiometryLabel()

    // MARK: - Account type detection

    @State private var providerIds: [String] = []
    @State private var isLoadingAccounts = true

    // MARK: - Password change form

    @State private var currentPassword: String = ""
    @State private var newPassword: String = ""
    @State private var isChangingPassword = false
    @State private var passwordSuccessMessage: String?
    @State private var passwordErrorMessage: String?

    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    /// True when at least one linked account uses email/password.
    private var isCredentialAccount: Bool {
        providerIds.contains("credential")
    }

    /// True when at least one linked account uses Google.
    private var isGoogleAccount: Bool {
        providerIds.contains { $0.lowercased().contains("google") }
    }

    var body: some View {
        BrettSettingsScroll {
            // App Lock
            BrettSettingsSection("App Lock") {
                Toggle(isOn: $faceIDEnabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(biometryAvailable ? "\(biometryType) app lock" : "Biometrics unavailable")
                            .foregroundStyle(BrettColors.textCardTitle)
                        Text(biometryAvailable
                             ? "Require \(biometryType) when opening Brett"
                             : "This device doesn't support biometric authentication.")
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)
                    }
                }
                .tint(BrettColors.gold)
                .disabled(!biometryAvailable)
                .onChange(of: faceIDEnabled) { _, _ in
                    BiometricLockManager.shared.settingsDidChange()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }

            // Sign-in method
            if !isLoadingAccounts {
                BrettSettingsSection("Sign-in Method") {
                    if isGoogleAccount {
                        HStack(spacing: 10) {
                            Image(systemName: "g.circle.fill")
                                .font(.system(size: 20))
                                .foregroundStyle(BrettColors.gold)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Signed in with Google")
                                    .foregroundStyle(BrettColors.textCardTitle)
                                Text("Password changes are managed through your Google account.")
                                    .font(BrettTypography.taskMeta)
                                    .foregroundStyle(BrettColors.textMeta)
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                    } else if isCredentialAccount {
                        HStack(spacing: 10) {
                            Image(systemName: "envelope.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(BrettColors.gold)
                            Text("Email & Password")
                                .foregroundStyle(BrettColors.textCardTitle)
                            Spacer()
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                    } else {
                        // Fallback for unknown provider types
                        HStack {
                            Text(providerIds.joined(separator: ", "))
                                .foregroundStyle(BrettColors.textCardTitle)
                            Spacer()
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                    }
                }
            }

            // Password change (credential accounts only)
            if isCredentialAccount {
                passwordChangeSection
            }
        }
        .navigationTitle("Security")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { await loadAccounts() }
    }

    // MARK: - Password change section

    @ViewBuilder
    private var passwordChangeSection: some View {
        BrettSettingsSection("Change Password") {
            SecureField("Current password", text: $currentPassword)
                .foregroundStyle(.white)
                .textContentType(.password)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

            BrettSettingsDivider()

            SecureField("New password", text: $newPassword)
                .foregroundStyle(.white)
                .textContentType(.newPassword)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

            BrettSettingsDivider()

            Button {
                Task { await changePassword() }
            } label: {
                HStack {
                    Spacer()
                    if isChangingPassword {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(BrettColors.gold)
                    } else {
                        Text("Update Password")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(BrettColors.gold)
                    }
                    Spacer()
                }
                .padding(.vertical, 12)
            }
            .disabled(isChangingPassword || currentPassword.isEmpty || newPassword.isEmpty)
            .padding(.horizontal, 14)
        }

        if let passwordSuccessMessage {
            Text(passwordSuccessMessage)
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.gold)
                .padding(.top, -16)
        }

        if let passwordErrorMessage {
            Text(passwordErrorMessage)
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.error)
                .padding(.top, -16)
        }
    }

    // MARK: - Network

    private func loadAccounts() async {
        isLoadingAccounts = true
        defer { isLoadingAccounts = false }

        do {
            let response: ListAccountsResponse = try await client.request(
                path: "/api/auth/list-accounts",
                method: "GET"
            )
            providerIds = response.data.map(\.providerId)
        } catch {
            // Non-fatal — the section just won't show. The Face ID toggle
            // still works regardless.
        }
    }

    private func changePassword() async {
        isChangingPassword = true
        passwordSuccessMessage = nil
        passwordErrorMessage = nil
        defer { isChangingPassword = false }

        do {
            let body = ChangePasswordBody(
                currentPassword: currentPassword,
                newPassword: newPassword
            )
            let encoded = try JSONEncoder().encode(body)
            _ = try await client.rawRequest(
                path: "/api/auth/change-password",
                method: "POST",
                body: encoded
            )
            passwordSuccessMessage = "Password updated successfully."
            currentPassword = ""
            newPassword = ""
        } catch let apiError as APIError {
            passwordErrorMessage = apiError.userFacingMessage
        } catch {
            passwordErrorMessage = "Couldn't update password. Please try again."
        }
    }

    // MARK: - Biometry label

    /// Returns "Face ID", "Touch ID", "Optic ID", or a generic fallback.
    private static func resolveBiometryLabel() -> String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch ctx.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        case .none: return "Biometrics"
        @unknown default: return "Biometrics"
        }
    }
}

// MARK: - API models (private to this file)

/// Response shape for `GET /api/auth/list-accounts`.
/// Server returns `{ data: [{ providerId: string, ... }] }`.
private struct ListAccountsResponse: Decodable {
    let data: [Account]

    struct Account: Decodable {
        let providerId: String
    }
}

/// Body for `POST /api/auth/change-password`.
private struct ChangePasswordBody: Encodable {
    let currentPassword: String
    let newPassword: String
}

