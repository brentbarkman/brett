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

    /// True once we've established a working session in this process —
    /// either via a successful keychain-hydrate refresh or a fresh sign-in.
    /// Until then, a 401 from the launch-time refresh paths is treated as
    /// potentially transient (server blip, deploy race, secret-rotation
    /// race) and we KEEP the user's cached state. Without this gate, a
    /// single cold-launch 401 wipes the bearer token AND the local
    /// SwiftData mirror, producing a "I just hard-killed and now I'm
    /// signed out with no tasks" failure mode. After the first successful
    /// refresh, 401 escalates to `clearInvalidSession()` as before.
    private var hasSuccessfullyRefreshed: Bool = false

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

    /// Legacy UserDefaults sentinel key. UserDefaults is restored from
    /// encrypted iTunes/Finder backups and device-to-device migration
    /// (Quick Start), so its presence can't prove the purge actually ran
    /// on THIS device. The current sentinel is in the Keychain with
    /// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` +
    /// `kSecAttrSynchronizable = false`, which doesn't get restored. This
    /// key is still read for the one-shot migration below.
    private static let legacyInstallSentinelKey = "brett.auth.installSentinel.v1"

    /// First-launch purge of stale keychain tokens. Idempotent thereafter.
    ///
    /// Detection order:
    /// 1. If the Keychain sentinel is present → this install has already
    ///    run the purge on this device. No-op.
    /// 2. Else, if the legacy UserDefaults sentinel is present → treat as
    ///    "already purged" (grandfather existing users) and migrate the
    ///    marker into the Keychain so future checks are backup-safe.
    /// 3. Else, this is a fresh arrival on this device. Purge the token
    ///    and write the Keychain sentinel.
    private static func purgeKeychainIfFreshInstall() {
        if KeychainStore.hasInstallSentinel() {
            return
        }

        let defaults = UserDefaults.standard
        if defaults.bool(forKey: legacyInstallSentinelKey) {
            // Migrate: the app had already run at least once on what is
            // presumed to be this device, so we won't wipe the token —
            // but we move the sentinel to the Keychain so a future backup
            // restore can't fool us.
            KeychainStore.writeInstallSentinel()
            BrettLog.auth.info("Migrated install sentinel from UserDefaults to Keychain")
            return
        }

        // First run of this install on this device (or a post-restore
        // reinstall). Wipe any residual token — it was either from a
        // prior install on this device or a backup from a different
        // user's device; either way using it would surprise the user.
        do {
            try KeychainStore.deleteToken()
            BrettLog.auth.info("Fresh install detected on this device — purged residual keychain token")
        } catch {
            BrettLog.auth.error("Keychain purge on fresh install failed: \(String(describing: error), privacy: .public)")
        }
        KeychainStore.writeInstallSentinel()
        // Write the legacy flag too so a downgrade to an older build
        // doesn't redundantly purge.
        defaults.set(true, forKey: legacyInstallSentinelKey)
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

    /// **User-initiated** sign-out. Wipes local SwiftData on the assumption
    /// the device may be handed to a different person — the gentler variant
    /// `clearInvalidSession()` is what we use when the SERVER rejects our
    /// token (same user, just needs to re-auth, no reason to drop their
    /// cached items).
    ///
    /// Order matters:
    ///  1. End the active `Session` first. Cancels the SyncManager's tasks
    ///     (push, pull, poll, debounce) and disconnects SSE so no in-flight
    ///     network completion can race the wipe below and write old-user
    ///     rows into the new user's empty store.
    ///  2. Clear non-data state (token, currentUser, App Group mirror) so
    ///     the UI gates back to SignInView. Per-store in-memory caches
    ///     (SelectionStore, ChatStore, etc.) are wiped by
    ///     `ClearableStoreRegistry.clearAll()`, fanned out from
    ///     `Session.tearDown()` in step 1.
    ///  3. Wipe SwiftData. Safe now that no sync task is still running.
    ///  4. Best-effort server sign-out.
    func signOut() async {
        ActiveSession.end()

        token = nil
        currentUser = nil
        hasSuccessfullyRefreshed = false
        try? KeychainStore.deleteToken()
        // Clear the mirrored user-id in the App Group so a pending share
        // from this user can't leak into the next sign-in's account.
        SharedConfig.writeCurrentUserId(nil)
        // Drop the user-switch sentinel too — a deliberate sign-out resets
        // the device to "no signed-in user," and a future sign-in by the
        // same person should not be flagged as a switch.
        SharedConfig.clearLastSignedInUserId()

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

    /// **Server-rejected token.** Clears auth state but PRESERVES local
    /// SwiftData — the user is the same person, they just need to re-auth.
    /// Wiping their items / lists / events here would force a long full
    /// re-pull on the next sign-in for no security benefit (the data
    /// already lives on disk; re-authenticating doesn't change ownership).
    ///
    /// Multi-user safety is handled at the next `persist(session:)` call
    /// instead: it compares the incoming user-id against
    /// `SharedConfig.lastSignedInUserId` and wipes if they differ.
    private func clearInvalidSession() async {
        ActiveSession.end()

        token = nil
        currentUser = nil
        hasSuccessfullyRefreshed = false
        try? KeychainStore.deleteToken()
        SharedConfig.writeCurrentUserId(nil)
        // Note: we deliberately do NOT clear `lastSignedInUserId` here. It
        // sticks around so persist() can detect a user-switch on the next
        // sign-in and wipe stale rows defensively.

        do {
            try await endpoints.signOut()
        } catch {
            // The token is already invalid server-side — this call will
            // likely 401 too. Not fatal.
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
        // User-switch defense. If the previous session ended via
        // `clearInvalidSession()` (no SwiftData wipe) and a different user
        // is now signing in, drop the stale rows here so user B's queries
        // don't render user A's items between sign-in and the first sync
        // round. Same-user re-sign-in (the common case after a token
        // expiry) skips this and keeps the local cache warm.
        if let lastId = SharedConfig.resolveLastSignedInUserId(),
           lastId != session.user.id {
            BrettLog.auth.info("User switch detected on sign-in — wiping prior user's local data")
            PersistenceController.shared.wipeAllData()
        }

        try KeychainStore.writeToken(session.token)
        self.token = session.token
        self.currentUser = session.user
        // Sign-in counts as an established session — subsequent 401s in
        // this process should escalate, not be deferred.
        self.hasSuccessfullyRefreshed = true

        // Mirror the current user-id into the App Group so the share
        // extension can stamp captured payloads with the right account —
        // prevents cross-user contamination on account switches.
        SharedConfig.writeCurrentUserId(session.user.id)
        // Persistent user-switch sentinel. Survives `clearInvalidSession()`
        // so the next persist() can compare against it.
        SharedConfig.writeLastSignedInUserId(session.user.id)

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
    /// environment, revoked), we eventually need to clear it. Otherwise the
    /// app stays in a zombie state: `isAuthenticated == true`, UI past
    /// login, every request 401s.
    ///
    /// **Cold-launch lenience:** until `hasSuccessfullyRefreshed` flips
    /// true (either via this method or `persist(session:)`), a 401 is
    /// treated as potentially transient — we log and keep the cached
    /// state so a one-off launch blip doesn't kick the user back to the
    /// sign-in screen and force a full re-pull on next sign-in. Once we
    /// HAVE established a session this process, a subsequent 401 is taken
    /// at face value and `clearInvalidSession()` runs.
    func refreshCurrentUser() async {
        guard token != nil else { return }
        do {
            let me = try await endpoints.getMe()
            self.currentUser = me
            self.lastRefreshedAt = Date()
            self.hasSuccessfullyRefreshed = true
            // Mirror to the App Group so the share extension sees the
            // right user-id even on the "already signed in at launch"
            // path (where `persist(session:)` wasn't called this run).
            SharedConfig.writeCurrentUserId(me.id)
            // Keep the user-switch sentinel current too, in case the
            // legacy install pre-dates persist() writing it.
            SharedConfig.writeLastSignedInUserId(me.id)
            // Install a session if this is the keychain-hydrate path
            // (persist() already installed one on fresh sign-in; the call
            // is idempotent because ActiveSession.begin replaces any prior).
            if ActiveSession.userId != me.id {
                installSession(for: me.id)
            }
        } catch APIError.unauthorized {
            guard hasSuccessfullyRefreshed else {
                // Cold-launch path: don't clear anything yet. The next
                // foreground refresh (or scene-active keepalive) will
                // re-validate; once one of them succeeds, the gate flips
                // and any later 401 escalates as before.
                BrettLog.auth.info("Cold-launch /users/me 401 — keeping cached state until next refresh")
                return
            }
            BrettLog.auth.info("Token rejected — clearing invalid session")
            await clearInvalidSession()
        } catch {
            // Other errors (network, timeout) are transient — leave the
            // existing currentUser in place so the UI doesn't flicker out.
        }
    }

    /// Foreground-keepalive: re-validate the session if it's been a while
    /// since the last check. Throttled at one ping per five minutes so
    /// rapid app-switches don't generate traffic.
    ///
    /// Uses `/api/auth/ios/session` — a lightweight endpoint that returns
    /// just `{ token, expiresAt, user: { id, email } }` rather than the
    /// full profile payload of `/users/me`. The main practical benefit
    /// is detecting zombie tokens (revoked server-side, user signed out
    /// from another device, keychain that survived uninstall of a
    /// different-env install) and gracefully signing out instead of
    /// letting every subsequent request silently 401.
    ///
    /// better-auth's session-extension is automatic — hitting the
    /// endpoint with a valid bearer updates `session.updatedAt` if we're
    /// within the `updateAge` window, which slides the expiration
    /// forward. So this call doubles as both a health check AND a
    /// session refresh.
    func refreshIfStale(threshold: TimeInterval = 300) async {
        guard token != nil else { return }
        if let last = lastRefreshedAt, Date().timeIntervalSince(last) < threshold {
            return
        }

        do {
            let session = try await endpoints.getSession()
            self.lastRefreshedAt = Date()
            self.hasSuccessfullyRefreshed = true
            // Session token rotation isn't exposed by better-auth's bearer
            // plugin today (the token string stays the same across
            // extensions). If that changes in a future endpoint contract,
            // persist the new token here.
            if session.user.id != currentUser?.id {
                // User id changed under us — full sign-out (including data
                // wipe). This shouldn't happen but covers the case where
                // the server reassigned the token to a different account,
                // and rendering the prior user's items to the new account
                // is the exact failure mode we wipe to prevent.
                BrettLog.auth.error("Session endpoint returned different user id — signing out")
                await signOut()
            }
        } catch APIError.unauthorized {
            guard hasSuccessfullyRefreshed else {
                // Cold-launch path: same lenience as `refreshCurrentUser`.
                // The user keeps their cached state; a later refresh will
                // either succeed or escalate.
                BrettLog.auth.info("Cold-launch /api/auth/ios/session 401 — keeping cached state until next refresh")
                return
            }
            BrettLog.auth.info("Session invalid — clearing invalid session")
            await clearInvalidSession()
        } catch {
            // Network / server blip — leave state in place. The next
            // keepalive will retry.
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
    ///
    /// `hasRefreshed` controls whether the injected state counts as a
    /// "successfully validated" session (the default — UI tests behave as
    /// if the user has been signed in for a while). Unit tests that want
    /// to exercise the cold-launch lenience path pass `false` to simulate
    /// the "token loaded from keychain, /users/me hasn't returned yet"
    /// state.
    @MainActor
    func injectFakeSession(user: AuthUser, token: String, hasRefreshed: Bool = true) {
        self.token = token
        self.currentUser = user
        self.hasSuccessfullyRefreshed = hasRefreshed
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
