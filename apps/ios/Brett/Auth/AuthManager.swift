import Foundation
import Observation

/// The single source of truth for auth state in the app.
///
/// Exposes `currentUser`, `token`, and `isAuthenticated` as observable
/// properties. Persists the session token in the Keychain via `KeychainStore`.
/// User profile data (timezone, avatar etc.) is held in memory here; the
/// `UserProfile` SwiftData model is managed by a separate agent's code.
///
/// Wires itself to `APIClient.shared` on init so every outgoing request
/// automatically picks up the current bearer token.
@MainActor
@Observable
final class AuthManager {
    // MARK: - State

    private(set) var currentUser: AuthUser?
    private(set) var token: String?
    private(set) var isLoading: Bool = false
    private(set) var errorMessage: String?
    /// True when the last sign-in attempt failed because the email/password
    /// combo didn't match an existing account. `SignInView` reads this to
    /// offer a "create account" CTA instead of a plain error banner.
    private(set) var errorIsNoAccount: Bool = false

    /// True when a token + user are present. Used by the app-level gate to
    /// decide between SignInView and MainContainer.
    var isAuthenticated: Bool {
        token != nil
    }

    // MARK: - Dependencies

    private let endpoints: AuthEndpoints
    private let client: APIClient

    // MARK: - Init

    init(client: APIClient = .shared) {
        self.client = client
        self.endpoints = AuthEndpoints(client: client)

        // Wire the APIClient token provider *before* loading the stored token
        // so the first /users/me call uses it.
        client.tokenProvider = { [weak self] in
            // Captured on the main actor — safe because APIClient is @MainActor.
            MainActor.assumeIsolated { self?.token }
        }

        // Hydrate from Keychain synchronously, then kick off a background
        // /users/me to refresh the user record. If Keychain read fails we
        // treat it as "not signed in" (no need to surface the error).
        if let stored = try? KeychainStore.readToken() {
            self.token = stored
            Task { await self.refreshCurrentUser() }
        }
    }

    // MARK: - Sign-in flows

    func signInEmail(email: String, password: String) async {
        await runSignIn {
            let provider = EmailAuthProvider(
                email: email,
                password: password,
                mode: .signIn,
                endpoints: self.endpoints
            )
            return try await provider.signIn()
        }
    }

    func signUpEmail(email: String, password: String, name: String) async {
        await runSignIn {
            let provider = EmailAuthProvider(
                email: email,
                password: password,
                mode: .signUp(name: name),
                endpoints: self.endpoints
            )
            return try await provider.signIn()
        }
    }

    func signInApple() async {
        await runSignIn { [endpoints] in
            let provider = AppleSignInProvider(endpoints: endpoints)
            return try await provider.signIn()
        }
    }

    func signInGoogle() async {
        await runSignIn { [endpoints] in
            let provider = GoogleSignInProvider(endpoints: endpoints)
            return try await provider.signIn()
        }
    }

    // MARK: - Sign-out

    /// Clears local state and the Keychain entry, then attempts to notify the
    /// server (best effort). The local clear happens first so a server error
    /// can't leave the user stuck in a signed-in UI.
    func signOut() async {
        token = nil
        currentUser = nil
        try? KeychainStore.deleteToken()
        // Clear the mirrored user-id in the App Group so a pending share
        // from this user can't leak into the next sign-in's account.
        SharedConfig.writeCurrentUserId(nil)

        do {
            try await endpoints.signOut()
        } catch {
            // Server might be offline or the session already gone. Not fatal.
        }
    }

    // MARK: - Internals

    /// Runs a provider-returning closure, handles loading/error state, and
    /// persists the resulting session. Closure is MainActor-isolated — it
    /// typically constructs a provider (which must be on the main actor) and
    /// awaits its sign-in call.
    private func runSignIn(_ action: () async throws -> AuthSession) async {
        isLoading = true
        errorMessage = nil
        errorIsNoAccount = false
        defer { isLoading = false }

        do {
            let session = try await action()
            try await persist(session: session)
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
            if case .invalidCredentials = apiError {
                errorIsNoAccount = true
            }
        } catch {
            errorMessage = APIError.unknown(error).userFacingMessage
        }
    }

    /// Saves the token to Keychain, updates in-memory state, and hydrates the
    /// user record from /users/me so we have the full profile (timezone,
    /// assistantName, etc.).
    private func persist(session: AuthSession) async throws {
        try KeychainStore.writeToken(session.token)
        self.token = session.token
        self.currentUser = session.user

        // Mirror the current user-id into the App Group so the share
        // extension can stamp captured payloads with the right account —
        // prevents cross-user contamination on account switches.
        SharedConfig.writeCurrentUserId(session.user.id)

        // Hydrate full user profile. Non-fatal if it fails — we already have
        // a minimal user from the sign-in response.
        await refreshCurrentUser()
    }

    /// Best-effort refresh of `currentUser` via `/users/me`.
    ///
    /// **401 handling is load-bearing:** the keychain access group
    /// (`com.brett.app.auth`) survives app deletion, which means a token
    /// can persist across reinstalls — including from a build that pointed
    /// at a different API. If the stored token is invalid (expired, wrong
    /// environment, revoked), we *must* sign out here. Otherwise the app
    /// stays in a zombie state: `isAuthenticated == true`, UI past login,
    /// every request 401s, sync fails silently, and there's no user-facing
    /// escape hatch until Settings gets a sign-out button.
    func refreshCurrentUser() async {
        guard token != nil else { return }
        do {
            self.currentUser = try await endpoints.getMe()
            // Mirror to the App Group so the share extension sees the
            // right user-id even on the "already signed in at launch"
            // path (where `persist(session:)` wasn't called this run).
            if let userId = self.currentUser?.id {
                SharedConfig.writeCurrentUserId(userId)
            }
        } catch APIError.unauthorized {
            // Token is no good — fall back to the login screen.
            await signOut()
        } catch {
            // Other errors (network, timeout) are transient — leave the
            // existing currentUser in place so the UI doesn't flicker out.
        }
    }

    /// Clears a previously-surfaced error message. Called by the UI when the
    /// user edits a field or dismisses the banner.
    func clearError() {
        errorMessage = nil
        errorIsNoAccount = false
    }

    #if DEBUG
    /// Injects a fake session for UI tests. Bypasses Keychain + network and
    /// flips `isAuthenticated` to true so the app transitions straight to
    /// `MainContainer`. DEBUG-only — never compiled into App Store builds.
    @MainActor
    func injectFakeSession(user: AuthUser, token: String) {
        self.token = token
        self.currentUser = user
    }
    #endif
}

#if DEBUG
extension AuthUser {
    /// Canonical test user — shared by UI-test launch-arg injection so every
    /// test sees the same identity without needing real credentials.
    static let testUser = AuthUser(
        id: "uitest-user-id",
        email: "uitest@brett.app",
        name: "UI Test",
        avatarUrl: nil,
        timezone: "America/Los_Angeles",
        assistantName: "Brett"
    )
}
#endif
