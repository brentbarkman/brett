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
        defer { isLoading = false }

        do {
            let session = try await action()
            try await persist(session: session)
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
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

        // Hydrate full user profile. Non-fatal if it fails — we already have
        // a minimal user from the sign-in response.
        await refreshCurrentUser()
    }

    /// Best-effort refresh of `currentUser` via `/users/me`.
    func refreshCurrentUser() async {
        guard token != nil else { return }
        do {
            self.currentUser = try await endpoints.getMe()
        } catch {
            // Leave existing currentUser in place if the refresh fails.
        }
    }

    /// Clears a previously-surfaced error message. Called by the UI when the
    /// user edits a field or dismisses the banner.
    func clearError() {
        errorMessage = nil
    }
}
