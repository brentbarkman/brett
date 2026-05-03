import Foundation
import LocalAuthentication
import Observation
import SwiftData

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
    /// True between init (when Face ID is enabled) and the first successful
    /// `hydrateFromKeychain(authContext:)` call. `RootView` reads this to
    /// show `BiometricLockView` during the window before the token has been
    /// read from the keychain — preventing a brief flash of `SignInView`.
    private(set) var isHydratingFromKeychain: Bool = false
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

    /// Delays between retries when `retryingOnUnauthorized` encounters an
    /// `APIError.unauthorized` response, expressed in nanoseconds.
    ///
    /// Production default: 1 s → 2 s → 4 s (exponential backoff, 3 retries).
    /// Tests override this with `[0, 0, 0]` to keep the suite fast.
    private let retryDelays: [UInt64]

    // MARK: - Init

    init(client: APIClient = .shared,
         retryDelays: [UInt64] = [1_000_000_000, 2_000_000_000, 4_000_000_000]) {
        self.client = client
        self.endpoints = AuthEndpoints(client: client)
        self.retryDelays = retryDelays

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

        // Hydration timing depends on Face ID setting:
        //
        // - Face ID OFF: hydrate now. Existing pre-Phase-5 behavior. The
        //   keychain entry is non-gated, no LAContext needed.
        //
        // - Face ID ON: defer until BiometricLockManager publishes an
        //   authenticated LAContext via `authenticatedContext`. RootView in
        //   BrettApp.swift watches that property and calls
        //   `hydrateFromKeychain(authContext:)` when the user passes Face ID.
        //
        // Without this conditional, reading a biometric-gated keychain entry
        // without a context would prompt the OS for Face ID immediately at
        // app launch, bypassing the lock screen we already use for the same
        // purpose.
        if UserDefaults.standard.bool(forKey: BiometricLockManager.faceIDEnabledKey) {
            // Mark hydration as pending so RootView shows BiometricLockView
            // instead of SignInView while we're waiting for biometric unlock.
            isHydratingFromKeychain = true
        } else {
            Task { [weak self] in await self?.hydrateFromKeychain(authContext: nil) }
        }
    }

    /// Public entry point for keychain hydration. Used by both:
    ///  - The Face-ID-OFF cold-launch path (init schedules this with
    ///    `authContext: nil`).
    ///  - The Face-ID-ON post-unlock path (RootView calls this with
    ///    `authContext: BiometricLockManager.shared.authenticatedContext`
    ///    after a successful biometric unlock).
    ///
    /// Idempotent: calling twice is harmless — the second call returns
    /// early because `token` is already set.
    func hydrateFromKeychain(authContext: LAContext?) async {
        defer { isHydratingFromKeychain = false }
        guard token == nil else { return } // already hydrated
        do {
            guard let stored = try KeychainStore.readToken(authContext: authContext) else {
                return
            }
            self.token = stored
            await refreshCurrentUser()
        } catch {
            BrettLog.auth.error("Keychain hydrate failed: \(String(describing: error), privacy: .public)")
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
    ///     (NavStore, ChatStore, etc.) are wiped by
    ///     `ClearableStoreRegistry.clearAll()`, fanned out from
    ///     `Session.tearDown()` in step 1.
    ///  3. Wipe SwiftData. Safe now that no sync task is still running.
    ///  4. Best-effort server sign-out.
    func signOut() async {
        // Deliberate sign-out: clear the soft sign-out hint so the device
        // doesn't show the prior user's "please sign in again" banner if
        // handed to a different person.
        SessionExpiryHint.clear()

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
            BrettLog.auth.error("Server sign-out failed (non-fatal): \(String(describing: error), privacy: .public)")
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
        // Soft sign-out UX: capture the email so SignInView can prefill it,
        // and flag the next sign-in screen to show a "please sign in again"
        // banner. If currentUser is nil here (theoretically possible if the
        // 401 races a pre-refresh cold launch), the banner still fires but
        // the email field won't prefill — acceptable degradation.
        if let email = currentUser?.email {
            SessionExpiryHint.lastEmail = email
        }
        SessionExpiryHint.didExpire = true

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
            // Token is already invalid server-side; this call will likely
            // 401 too. Log at info because the failure is expected.
            BrettLog.auth.info("Server sign-out after invalid-session 401 failed (expected): \(String(describing: error), privacy: .public)")
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
        } catch let kc as KeychainStore.KeychainError {
            BrettLog.auth.error("Keychain write failure during sign-in: \(String(describing: kc), privacy: .public)")
            errorMessage = APIError.keychainWriteFailed.userFacingMessage
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
            if case .invalidCredentials = apiError {
                errorIsNoAccount = true
            }
        } catch {
            errorMessage = APIError.unknown(error).userFacingMessage
        }
    }

    /// Calls `attempt()` and returns its result.
    ///
    /// If `attempt()` throws `APIError.unauthorized`, sleeps for the
    /// next delay in `retryDelays` then retries. Any other error bubbles
    /// up immediately without retrying. After exhausting all configured
    /// delays (i.e., `retryDelays.count` retries), the final unauthorized
    /// error is rethrown so the caller can decide what to do.
    ///
    /// Production delays: 1 s → 2 s → 4 s (configurable via the init
    /// parameter for test speed).
    private func retryingOnUnauthorized<T>(_ attempt: () async throws -> T) async throws -> T {
        var lastError: Error = APIError.unauthorized
        for (index, delay) in ([UInt64(0)] + retryDelays).enumerated() {
            if index > 0 {
                // Sleep before each retry (index 0 is the initial attempt —
                // its "delay" of 0 is just a sentinel to unify the loop).
                try? await Task.sleep(nanoseconds: delay)
            }
            do {
                return try await attempt()
            } catch APIError.unauthorized {
                lastError = APIError.unauthorized
                // Continue to next iteration (retry).
            } catch {
                // Non-401 errors are not retried.
                throw error
            }
        }
        throw lastError
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
        //
        // Three branches:
        //   1. Sentinel matches incoming user → same user, skip wipe
        //      (warm cache).
        //   2. Sentinel exists but differs → user switch, wipe.
        //   3. Sentinel is nil → can't prove ownership of any local rows.
        //      App Group might be misconfigured (ad-hoc build, post-
        //      uninstall reinstall), or the sentinel migration race lost
        //      it. If there's any non-trivial local data on disk,
        //      defensively wipe so the incoming user can never observe a
        //      prior user's MutationQueueEntry / ConflictLogEntry /
        //      SyncHealth rows that aren't yet user-scoped. On a clean
        //      device this is a no-op.
        let lastId = SharedConfig.resolveLastSignedInUserId()
        if let lastId, lastId != session.user.id {
            BrettLog.auth.info("User switch detected on sign-in — wiping prior user's local data")
            PersistenceController.shared.wipeAllData()
        } else if lastId == nil {
            let context = PersistenceController.shared.mainContext
            // Probe representative tables — if any have rows, the device
            // isn't clean and we can't trust them to belong to the
            // incoming user. We check a handful (UserProfile, Item,
            // MutationQueueEntry) so a single empty table doesn't mask
            // leftover state in the others.
            let hasRows: Bool = {
                if let row = (try? context.fetch(FetchDescriptor<UserProfile>()))?.first { _ = row; return true }
                if let row = (try? context.fetch(FetchDescriptor<Item>()))?.first { _ = row; return true }
                if let row = (try? context.fetch(FetchDescriptor<MutationQueueEntry>()))?.first { _ = row; return true }
                return false
            }()
            if hasRows {
                BrettLog.auth.info("Sign-in with missing last-user sentinel + non-empty local data — wiping defensively")
                PersistenceController.shared.wipeAllData()
            }
        }

        let useGate = UserDefaults.standard.bool(forKey: BiometricLockManager.faceIDEnabledKey)
        try KeychainStore.writeToken(session.token, biometricGated: useGate)
        self.token = session.token
        self.currentUser = session.user
        // Sign-in counts as an established session — subsequent 401s in
        // this process should escalate, not be deferred.
        self.hasSuccessfullyRefreshed = true

        // Soft sign-out UX: stash the email for the next sign-in's prefill,
        // and clear any stale "expired" flag from a prior clearInvalidSession.
        // We re-write lastEmail every persist (not just first sign-in) so the
        // hint stays current if the user's account email changes.
        SessionExpiryHint.lastEmail = session.user.email
        SessionExpiryHint.didExpire = false

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
            let me = try await retryingOnUnauthorized { try await self.endpoints.getMe() }
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
            let session = try await retryingOnUnauthorized {
                try await self.endpoints.getSession()
            }
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

    /// Test-only entry into the `persist(session:)` path. Lets the
    /// AuthManager test suite exercise the user-switch + missing-sentinel
    /// defensive wipe branches without standing up a full mock auth
    /// provider chain.
    @MainActor
    func persistForTesting(session: AuthSession) async throws {
        try await persist(session: session)
    }

    /// Test-only setter for `isHydratingFromKeychain`. Lets unit tests
    /// simulate the Face-ID-ON init path (where `isHydratingFromKeychain`
    /// is set to `true` in `init()`) without relying on UserDefaults state
    /// that varies between test environments.
    @MainActor
    func testSetHydratingFromKeychain(_ value: Bool) {
        isHydratingFromKeychain = value
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
