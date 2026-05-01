import SwiftUI
import LocalAuthentication
import AuthenticationServices
import UIKit

/// Security preferences: Face ID app-lock, sign-in method info, password
/// change (for email/password accounts), and passkey management.
///
/// On appear we call `GET /api/auth/list-accounts` to determine the sign-in
/// method. If the account uses email/password ("credential"), we show a
/// password change form. If it uses Google, we show a read-only badge instead.
///
/// Passkeys are fetched from `GET /api/auth/passkey/list-user-passkeys`.
/// Registration uses the WebAuthn attestation dance: the server issues a
/// challenge via `GET /api/auth/passkey/generate-register-options`, the device
/// prompts the user via `ASAuthorizationPlatformPublicKeyCredentialProvider`,
/// then the attestation is POSTed to `/api/auth/passkey/verify-registration`.
/// The signed cookie set by the generate-register-options response must travel
/// with the verify request — `URLSession.shared`'s default cookie storage
/// carries it automatically.
struct SecuritySettingsView: View {
    // MARK: - Account type detection (parent-owned so the body can decide
    // whether to show the password-change section).

    @State private var providerIds: [String] = []
    @State private var isLoadingAccounts = true

    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    /// True when at least one linked account uses email/password.
    private var isCredentialAccount: Bool {
        providerIds.contains("credential")
    }

    var body: some View {
        BrettSettingsScroll {
            AppLockSection()

            // Sign-in method
            if !isLoadingAccounts {
                SignInMethodSection(providerIds: providerIds)
            }

            // Passkeys
            PasskeysSection(client: client)

            // Password change (credential accounts only)
            if isCredentialAccount {
                PasswordChangeSection(client: client)
            }
        }
        .navigationTitle("Security")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { await loadAccounts() }
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
}

// MARK: - App lock section

private struct AppLockSection: View {
    // Scoped per-user so two accounts on the same device don't share the
    // Face ID toggle — @State + explicit UserDefaults bridge because
    // @AppStorage keys must be compile-time constants.
    @State private var faceIDEnabled: Bool = false
    @State private var biometryAvailable: Bool = LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    @State private var biometryType: String = AppLockSection.resolveBiometryLabel()

    var body: some View {
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
            .onChange(of: faceIDEnabled) { _, newValue in
                UserDefaults.standard.set(newValue, forKey: BiometricLockManager.faceIDEnabledKey)
                BiometricLockManager.shared.settingsDidChange()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .onAppear {
            faceIDEnabled = UserDefaults.standard.bool(forKey: BiometricLockManager.faceIDEnabledKey)
        }
    }

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

// MARK: - Sign-in method section

private struct SignInMethodSection: View {
    let providerIds: [String]

    private var isCredentialAccount: Bool {
        providerIds.contains("credential")
    }

    private var isGoogleAccount: Bool {
        providerIds.contains { $0.lowercased().contains("google") }
    }

    var body: some View {
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
}

// MARK: - Password change section

private struct PasswordChangeSection: View {
    let client: APIClient

    @State private var currentPassword: String = ""
    @State private var newPassword: String = ""
    @State private var isChangingPassword = false
    @State private var passwordSuccessMessage: String?
    @State private var passwordErrorMessage: String?

    var body: some View {
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
}

// MARK: - Passkeys section

private struct PasskeysSection: View {
    let client: APIClient

    @State private var passkeys: [Passkey] = []
    @State private var isLoadingPasskeys = true
    @State private var passkeyErrorMessage: String?
    @State private var passkeySuccessMessage: String?
    @State private var isRegisteringPasskey = false
    @State private var passkeyIdPendingConfirm: String?
    @State private var passkeyIdDeleting: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            BrettSettingsSection("Passkeys") {
                if isLoadingPasskeys {
                    HStack {
                        Spacer()
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(BrettColors.gold)
                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 16)
                } else if passkeys.isEmpty {
                    Text("No passkeys yet. Add one to sign in without a password.")
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                } else {
                    ForEach(Array(passkeys.enumerated()), id: \.element.id) { index, passkey in
                        if index > 0 {
                            BrettSettingsDivider()
                        }
                        passkeyRow(for: passkey)
                    }
                }

                BrettSettingsDivider()

                Button {
                    Task { await registerPasskey() }
                } label: {
                    HStack(spacing: 8) {
                        if isRegisteringPasskey {
                            ProgressView()
                                .progressViewStyle(.circular)
                                .tint(BrettColors.gold)
                        } else {
                            Image(systemName: "plus.circle.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(BrettColors.gold)
                        }
                        Text(isRegisteringPasskey ? "Setting up passkey\u{2026}" : "Add Passkey")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(BrettColors.gold)
                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isRegisteringPasskey)
            }

            if let passkeySuccessMessage {
                Text(passkeySuccessMessage)
                    .font(.system(size: 12))
                    .foregroundStyle(BrettColors.success)
                    .padding(.horizontal, 4)
            }

            if let passkeyErrorMessage {
                Text(passkeyErrorMessage)
                    .font(.system(size: 12))
                    .foregroundStyle(BrettColors.error)
                    .padding(.horizontal, 4)
            }

            Text("Passkeys let you sign in with Face ID or Touch ID — no password needed. They're stored in iCloud Keychain.")
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.textMeta)
                .padding(.horizontal, 4)
        }
        .task { await loadPasskeys() }
    }

    @ViewBuilder
    private func passkeyRow(for passkey: Passkey) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "key.horizontal.fill")
                .font(.system(size: 14))
                .foregroundStyle(BrettColors.gold)
                .frame(width: 22, alignment: .leading)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 3) {
                Text(passkey.name?.isEmpty == false ? passkey.name! : "Passkey")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)

                if let createdAt = passkey.createdAt {
                    Text("Added \(formatPasskeyDate(createdAt))")
                        .font(.system(size: 11))
                        .foregroundStyle(BrettColors.textMeta)
                }
            }

            Spacer(minLength: 8)

            if passkeyIdPendingConfirm == passkey.id {
                HStack(spacing: 6) {
                    Button {
                        Task { await deletePasskey(passkey) }
                    } label: {
                        Text("Yes")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(BrettColors.error)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(BrettColors.error.opacity(0.15))
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(passkeyIdDeleting == passkey.id)

                    Button {
                        passkeyIdPendingConfirm = nil
                    } label: {
                        Text("Cancel")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(BrettColors.textCardTitle)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(Color.white.opacity(0.08))
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(passkeyIdDeleting == passkey.id)
                }
            } else {
                Button {
                    passkeyIdPendingConfirm = passkey.id
                } label: {
                    if passkeyIdDeleting == passkey.id {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(BrettColors.textMeta)
                            .frame(width: 16, height: 16)
                    } else {
                        Image(systemName: "trash")
                            .font(.system(size: 13))
                            .foregroundStyle(BrettColors.textMeta)
                            .frame(width: 28, height: 28)
                            .contentShape(Rectangle())
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Passkey networking

    private func loadPasskeys() async {
        isLoadingPasskeys = true
        defer { isLoadingPasskeys = false }

        do {
            // The list endpoint returns a bare array, not a wrapper object.
            let list: [Passkey] = try await client.request(
                path: "/api/auth/passkey/list-user-passkeys",
                method: "GET"
            )
            passkeys = list
        } catch let apiError as APIError {
            passkeyErrorMessage = apiError.userFacingMessage
        } catch {
            // Likely the endpoint isn't available yet or no session — show
            // empty state rather than a scary error.
            passkeys = []
        }
    }

    private func deletePasskey(_ passkey: Passkey) async {
        passkeyIdDeleting = passkey.id
        passkeyErrorMessage = nil
        passkeySuccessMessage = nil
        defer {
            passkeyIdDeleting = nil
            passkeyIdPendingConfirm = nil
        }

        do {
            struct DeleteBody: Encodable { let id: String }
            struct GenericResponse: Decodable {}
            let _: GenericResponse = try await client.request(
                path: "/api/auth/passkey/delete-passkey",
                method: "POST",
                body: DeleteBody(id: passkey.id)
            )
            passkeys.removeAll { $0.id == passkey.id }
            passkeySuccessMessage = "Passkey removed."
            clearPasskeyMessagesAfterDelay()
        } catch let apiError as APIError {
            passkeyErrorMessage = apiError.userFacingMessage
        } catch {
            passkeyErrorMessage = "Couldn't remove passkey."
        }
    }

    private func registerPasskey() async {
        isRegisteringPasskey = true
        passkeyErrorMessage = nil
        passkeySuccessMessage = nil
        defer { isRegisteringPasskey = false }

        do {
            let deviceName = Self.defaultPasskeyName()

            // 1. Ask the server for registration options. The server sets a
            //    signed cookie binding the challenge to the subsequent verify
            //    call — URLSession.shared's cookie storage handles that for us.
            let encodedName = deviceName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? deviceName
            let options: PublicKeyCredentialCreationOptions = try await client.requestRelative(
                relativePath: "/api/auth/passkey/generate-register-options?name=\(encodedName)&authenticatorAttachment=platform",
                method: "GET"
            )

            guard let challengeData = Base64URL.decode(options.challenge) else {
                throw PasskeyError.invalidServerResponse("challenge")
            }
            guard let userIdData = Base64URL.decode(options.user.id) else {
                throw PasskeyError.invalidServerResponse("user.id")
            }

            // 2. Kick off the platform passkey prompt.
            let registration = try await PasskeyRegistrar.register(
                relyingPartyIdentifier: Self.passkeyRelyingPartyIdentifier,
                challenge: challengeData,
                name: options.user.name,
                userID: userIdData
            )

            // 3. Package the attestation as WebAuthn JSON and POST it.
            let credentialIdB64 = Base64URL.encode(registration.credentialID)
            let clientDataB64 = Base64URL.encode(registration.rawClientDataJSON)
            let attestationB64 = Base64URL.encode(registration.rawAttestationObject ?? Data())

            struct VerifyBody: Encodable {
                let id: String
                let rawId: String
                let response: Response
                let type: String
                let authenticatorAttachment: String
                let clientExtensionResults: [String: String]

                struct Response: Encodable {
                    let clientDataJSON: String
                    let attestationObject: String
                }
            }

            let body = VerifyBody(
                id: credentialIdB64,
                rawId: credentialIdB64,
                response: .init(
                    clientDataJSON: clientDataB64,
                    attestationObject: attestationB64
                ),
                type: "public-key",
                authenticatorAttachment: "platform",
                clientExtensionResults: [:]
            )

            struct GenericResponse: Decodable {}
            let _: GenericResponse = try await client.request(
                path: "/api/auth/passkey/verify-registration",
                method: "POST",
                body: body
            )

            passkeySuccessMessage = "Passkey added."
            clearPasskeyMessagesAfterDelay()
            await loadPasskeys()
        } catch let authError as ASAuthorizationError {
            if authError.code == .canceled {
                // Silent — user dismissed the sheet.
            } else {
                passkeyErrorMessage = "Passkey setup failed. (\(authError.code.rawValue))"
            }
        } catch let passkeyError as PasskeyError {
            passkeyErrorMessage = passkeyError.message
        } catch let apiError as APIError {
            passkeyErrorMessage = apiError.userFacingMessage
        } catch let nsError as NSError {
            // ASAuthorization bridges a few NSErrors that aren't typed as
            // ASAuthorizationError. Surface the most common one (missing
            // associated-domains entitlement) with a clear message.
            if nsError.domain == "com.apple.AuthenticationServices.AuthorizationError" {
                passkeyErrorMessage = "Passkey setup required \u{2014} the app needs associated-domains configured for \(Self.passkeyRelyingPartyIdentifier)"
            } else {
                passkeyErrorMessage = "Couldn't set up passkey. \(nsError.localizedDescription)"
            }
        }
    }

    private func clearPasskeyMessagesAfterDelay() {
        Task {
            try? await Task.sleep(for: .seconds(3))
            passkeySuccessMessage = nil
            passkeyErrorMessage = nil
        }
    }

    // MARK: - Constants & helpers

    /// Matches the production better-auth `baseURL` hostname. Must also be
    /// declared in the app's `associated-domains` entitlement for the
    /// platform authenticator to accept it.
    private static let passkeyRelyingPartyIdentifier = "api.brett.brentbarkman.com"

    private static func defaultPasskeyName() -> String {
        let model = UIDevice.current.model
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        let date = formatter.string(from: Date())
        return "\(model) (\(date))"
    }

    private func formatPasskeyDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
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

/// Row model for a registered passkey. Shape comes from
/// `GET /api/auth/passkey/list-user-passkeys`.
private struct Passkey: Decodable, Identifiable {
    let id: String
    let name: String?
    let createdAt: Date?
    let deviceType: String?
    let backedUp: Bool?
}

/// Subset of the WebAuthn `PublicKeyCredentialCreationOptions` returned by
/// `GET /api/auth/passkey/generate-register-options`. We only decode the bits
/// ASAuthorization needs.
private struct PublicKeyCredentialCreationOptions: Decodable {
    let challenge: String
    let user: User
    let rp: RelyingParty?

    struct User: Decodable {
        let id: String
        let name: String
        let displayName: String?
    }

    struct RelyingParty: Decodable {
        let id: String?
        let name: String?
    }
}

private enum PasskeyError: Error {
    case invalidServerResponse(String)
    case unexpectedCredentialType

    var message: String {
        switch self {
        case .invalidServerResponse(let field):
            return "Server returned an invalid passkey response (\(field))."
        case .unexpectedCredentialType:
            return "Unexpected passkey credential type."
        }
    }
}

// MARK: - Base64URL helpers

/// WebAuthn uses base64url (RFC 4648 §5) everywhere — `-`/`_` instead of `+`/`/`,
/// no padding. Foundation only speaks standard base64, so we convert both ways.
private enum Base64URL {
    static func decode(_ value: String) -> Data? {
        var s = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        // Pad with "=" to a multiple of 4.
        let pad = (4 - s.count % 4) % 4
        s += String(repeating: "=", count: pad)
        return Data(base64Encoded: s)
    }

    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// MARK: - ASAuthorization continuation bridge (passkey registration)

/// Wraps the `ASAuthorizationController` + delegate callback dance into a
/// single async throwing function. Mirrors the shape of
/// `AppleSignInProvider.requestAppleCredential()`.
@MainActor
private enum PasskeyRegistrar {
    static func register(
        relyingPartyIdentifier: String,
        challenge: Data,
        name: String,
        userID: Data
    ) async throws -> ASAuthorizationPlatformPublicKeyCredentialRegistration {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: relyingPartyIdentifier
        )
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: name,
            userID: userID
        )

        let controller = ASAuthorizationController(authorizationRequests: [request])

        return try await withCheckedThrowingContinuation { continuation in
            let bridge = Bridge(continuation: continuation)
            // ASAC holds its delegate as weak — the bridge self-retains until
            // the continuation resumes.
            controller.delegate = bridge
            controller.presentationContextProvider = bridge
            bridge.controller = controller
            controller.performRequests()
        }
    }

    private final class Bridge: NSObject,
                                ASAuthorizationControllerDelegate,
                                ASAuthorizationControllerPresentationContextProviding {
        typealias Continuation = CheckedContinuation<ASAuthorizationPlatformPublicKeyCredentialRegistration, Error>

        var controller: ASAuthorizationController?
        private var continuation: Continuation?
        private var selfRetain: Bridge?

        init(continuation: Continuation) {
            self.continuation = continuation
            super.init()
            self.selfRetain = self
        }

        private func finish(_ result: Result<ASAuthorizationPlatformPublicKeyCredentialRegistration, Error>) {
            guard let cont = continuation else { return }
            continuation = nil
            switch result {
            case .success(let credential): cont.resume(returning: credential)
            case .failure(let error): cont.resume(throwing: error)
            }
            selfRetain = nil
            controller = nil
        }

        func authorizationController(
            controller: ASAuthorizationController,
            didCompleteWithAuthorization authorization: ASAuthorization
        ) {
            if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
                finish(.success(credential))
            } else {
                finish(.failure(PasskeyError.unexpectedCredentialType))
            }
        }

        func authorizationController(
            controller: ASAuthorizationController,
            didCompleteWithError error: Error
        ) {
            finish(.failure(error))
        }

        func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
            if let window = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows)
                .first(where: \.isKeyWindow) {
                return window
            }
            return ASPresentationAnchor()
        }
    }
}
