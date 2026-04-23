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

    /// Last time we successfully hit `/users/me`. Used by `refreshIfStale`
    /// to avoid hammering the server on every brief app-switch while still
    /// re-validating the session after real backgrounded gaps.
    private var lastRefreshedAt: Date?

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

        // Fresh-install detection. Keychain items with
        // `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` survive an app
        // uninstall/reinstall cycle — on a shared iPad this means installing
        // the app a second time can silently sign the device in as whoever
        // used it last. Track installs in UserDefaults (which IS wiped on
        // uninstall) and purge any leftover keychain entries on first-ever
        // launch of this install.
        Self.purgeKeychainIfFreshInstall()

        // Hydrate from Keychain synchronously, then kick off a background
        // /users/me to refresh the user record. If Keychain read fails we
        // treat it as "not signed in" (no need to surface the error).
        if let stored = try? KeychainStore.readToken() {
            self.token = stored
            // We don't have a user record yet (`/users/me` hasn't returned),
            // but we know there's a valid token. `refreshCurrentUser` hydrates
            // the user and, on success, installs the session.
            Task { await self.refreshCurrentUser() }
        }
    }

    /// Sentinel UserDefaults key. Presence = "this install has run before."
    /// Absence = "fresh install" (or install after uninstall, which is the
    /// case we care about). Scoped to the app, not the device, so each
    /// reinstall starts the handshake over.
    private static let installSentinelKey = "brett.auth.installSentinel.v1"

    /// First-launch purge of stale keychain tokens. Idempotent thereafter.
    private static func purgeKeychainIfFreshInstall() {
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: installSentinelKey) {
            return
        }
        // First run of this install. If the keychain still holds a token,
        // it's from a previous install owned by a different (or same)
        // user — either way the session is stale and using it would
        // surprise the user. Wipe everything we own in the keychain.
        do {
            try KeychainStore.deleteToken()
            BrettLog.auth.info("Fresh install detected — purged residual keychain token")
        } catch {
            // Non-fatal: a keychain that already had no token will report
            // errSecItemNotFound which KeychainStore should surface benignly.
            BrettLog.auth.error("Keychain purge on fresh install failed: \(String(describing: error), privacy: .public)")
        }
        defaults.set(true, forKey: installSentinelKey)
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
    /// server (best effort). Order is important:
    ///
    ///  1. End the active `Session` first. Cancels the SyncManager's tasks
    ///     (push, pull, poll, debounce) and disconnects SSE so no in-flight
    ///     network completion can race the wipe below and write old-user
    ///     rows into the new user's empty store.
    ///  2. Clear non-data state (token, currentUser, SelectionStore, App
    ///     Group mirror) so the UI gates back to SignInView.
    ///  3. Wipe SwiftData. Safe now that no sync task is still running.
    ///  4. Best-effort server sign-out.
    func signOut() async {
        ActiveSession.end()

        token = nil
        currentUser = nil
        try? KeychainStore.deleteToken()
        SelectionStore.shared.clear()
        // Clear the mirrored user-id in the App Group so a pending share
        // from this user can't leak into the next sign-in's account.
        SharedConfig.writeCurrentUserId(nil)

        // Wipe the local SwiftData store. Without this, the next user to
        // sign in on the same device sees the prior user's items / events /
        // scouts until the next sync lands (and stale sync cursors cause
        // an incremental pull that may never fetch some older rows the new
        // account actually has).
        PersistenceController.shared.wipeAllData()

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

    /// Saves the token to Keychain, updates in-memory state, hydrates the
    /// user record from /users/me, and installs a fresh `Session` so the
    /// mutation queue + sync engine + SSE come alive for this account only.
    private func persist(session: AuthSession) async throws {
        try KeychainStore.writeToken(session.token)
        self.token = session.token
        self.currentUser = session.user

        // Mirror the current user-id into the App Group so the share
        // extension can stamp captured payloads with the right account —
        // prevents cross-user contamination on account switches.
        SharedConfig.writeCurrentUserId(session.user.id)

        installSession(for: session.user.id)

        // Hydrate full user profile. Non-fatal if it fails — we already have
        // a minimal user from the sign-in response.
        await refreshCurrentUser()
    }

    /// Build and install a fresh `Session`. Called from `persist(session:)`
    /// and from the keychain-hydrate path in `refreshCurrentUser()` once
    /// we've confirmed the stored token is valid.
    private func installSession(for userId: String) {
        let session = Session(
            userId: userId,
            persistence: PersistenceController.shared
        )
        ActiveSession.begin(session)
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
            let me = try await endpoints.getMe()
            self.currentUser = me
            self.lastRefreshedAt = Date()
            // Mirror to the App Group so the share extension sees the
            // right user-id even on the "already signed in at launch"
            // path (where `persist(session:)` wasn't called this run).
            SharedConfig.writeCurrentUserId(me.id)
            // Install a session if this is the keychain-hydrate path
            // (persist() already installed one on fresh sign-in; the call
            // is idempotent because ActiveSession.begin replaces any prior).
            if ActiveSession.userId != me.id {
                installSession(for: me.id)
            }
        } catch APIError.unauthorized {
            // Token is no good — fall back to the login screen.
            BrettLog.auth.info("Token rejected — signing out")
            await signOut()
        } catch {
            // Other errors (network, timeout) are transient — leave the
            // existing currentUser in place so the UI doesn't flicker out.
        }
    }

    /// Foreground-keepalive: re-validate the session if it's been a while
    /// since we last hit `/users/me`. Throttled at one ping per five
    /// minutes so rapid app-switches don't generate traffic. Token-refresh
    /// (rotating the bearer for a fresh one) is a server concern — when
    /// `POST /api/auth/token/refresh` ships, swap this call to hit that
    /// endpoint and persist the new token to the Keychain.
    ///
    /// The main practical benefit today is detecting zombie tokens
    /// (revoked server-side, app reinstalled with stale keychain entry,
    /// user signed out from another device) and gracefully signing out
    /// instead of showing an app full of data that silently fails to sync.
    func refreshIfStale(threshold: TimeInterval = 300) async {
        guard token != nil else { return }
        if let last = lastRefreshedAt, Date().timeIntervalSince(last) < threshold {
            return
        }
        await refreshCurrentUser()
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
