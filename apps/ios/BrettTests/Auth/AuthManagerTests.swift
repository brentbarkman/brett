import Testing
import Foundation
import SwiftData
@testable import Brett

/// Tests for AuthManager's session-clear paths.
///
/// Two distinct exits the manager can take when something goes wrong with
/// the bearer token, and these tests pin down which one runs in which
/// scenario:
///
///   1. **`signOut()`** — user-initiated. Wipes the local SwiftData mirror
///      because the device might be handed to a different person.
///   2. **`clearInvalidSession()`** — server-rejected token. Same physical
///      person, just needs to re-auth, so the local cache stays.
///
/// Plus the **cold-launch lenience gate** added to keep a one-off 401 from
/// `/users/me` (server blip, deploy race, secret rotation) on app launch
/// from kicking the user back to the sign-in screen and forcing a full
/// re-pull on next sign-in. The gate (`hasSuccessfullyRefreshed`) only
/// flips after at least one successful session validation this process,
/// so the very first 401 stays "cached state intact" and only a later
/// 401 escalates to a real clear.
///
/// All tests use `MockURLProtocol` to stub the API and run against an
/// in-memory `PersistenceController.shared` so they don't touch disk.
@Suite("AuthManager", .tags(.auth), .serialized)
@MainActor
struct AuthManagerTests {

    // MARK: - Setup helpers

    /// Zero-delay retry array for tests. Three zeros = 3 retries with no
    /// sleep between attempts, so retry-path tests run in milliseconds
    /// rather than the production 7-second worst case (1s + 2s + 4s).
    /// The element COUNT must match the production retry count (currently 3
    /// — see `AuthManager.retryDelays` default).
    private static let testRetryDelays: [UInt64] = [0, 0, 0]

    /// Build an APIClient routed through `MockURLProtocol`. Because
    /// `APIClient.baseURL` is read from Info.plist on init, the tests use
    /// it directly when constructing stub URLs — keeps the assertion
    /// stable regardless of which Debug API URL the project.yml is
    /// configured with.
    private func makeTestClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: config)
        return APIClient(session: session)
    }

    /// Build a test `AuthManager` wired to `MockURLProtocol` with instant
    /// retry delays (0 ns) so retry tests run in milliseconds rather than ~7 s.
    private func makeTestManager(retryDelays: [UInt64] = Self.testRetryDelays) -> (AuthManager, APIClient) {
        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: retryDelays)
        return (manager, client)
    }

    /// Reset every shared bit of state these tests touch. Idempotent and
    /// safe to call from `defer` blocks. Order matters — `ActiveSession`
    /// must be torn down before swapping the persistence container so any
    /// in-flight SyncManager Task can't write into the new container.
    private func resetState() {
        ActiveSession.end()
        try? KeychainStore.deleteToken()
        SharedConfig.clearLastSignedInUserId()
        SharedConfig.writeCurrentUserId(nil)
        SessionExpiryHint.clear()
        MockURLProtocol.reset()
        PersistenceController.configureForTesting(inMemory: true)
    }

    private func seedItem(userId: String, title: String) {
        let context = PersistenceController.shared.mainContext
        context.insert(Item(userId: userId, title: title))
        try? context.save()
    }

    private func itemCount() -> Int {
        let context = PersistenceController.shared.mainContext
        return (try? context.fetch(FetchDescriptor<Item>()).count) ?? -1
    }

    private func usersMeURL(for client: APIClient) -> URL {
        client.baseURL.appendingPathComponent("users/me")
    }

    private func signOutURL(for client: APIClient) -> URL {
        client.baseURL.appendingPathComponent("api/auth/sign-out")
    }

    private func iosSessionURL(for client: APIClient) -> URL {
        client.baseURL.appendingPathComponent("api/auth/ios/session")
    }

    private func validUserMeBody(id: String, email: String) -> Data {
        // /users/me returns timezone + a few other fields; AuthUser's
        // CodingKeys decode only what we read, so the minimum payload is
        // just id+email+null fields. Server defaults make this a stable
        // shape for tests.
        Data(#"{"id":"\#(id)","email":"\#(email)","name":null,"avatarUrl":null,"timezone":"America/Los_Angeles","assistantName":"Brett"}"#.utf8)
    }

    /// Minimal valid response body for `/api/auth/ios/session`. Matches the
    /// shape of `SessionStatus` (token, expiresAt, user.id, user.email).
    ///
    /// Note: `expiresAt` deliberately uses `2099-01-01T00:00:00Z` with NO
    /// fractional seconds — `APIClient`'s decoder uses `.iso8601`, which
    /// rejects `.000Z`. Don't add milliseconds.
    private func validIOSSessionBody(token: String = "tok", userId: String, email: String) -> Data {
        Data(#"{"token":"\#(token)","expiresAt":"2099-01-01T00:00:00Z","user":{"id":"\#(userId)","email":"\#(email)"}}"#.utf8)
    }

    // MARK: - Cold-launch lenience

    /// **Regression guard.** The original symptom: hard-kill on TestFlight,
    /// relaunch, /users/me 401s, signOut runs, SwiftData wipes, user lands
    /// on sign-in screen with no tasks. Fix: the first 401 of a fresh
    /// process is treated as transient.
    @Test func coldLaunchUsersMe401KeepsTokenAndPreservesData() async {
        resetState()
        defer { resetState() }

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
        // Cold-launch state: token in keychain, /users/me hasn't returned
        // yet, no successful refresh established this process.
        manager.injectFakeSession(
            user: AuthUser(id: "u1", email: "u1@x.com"),
            token: "tok-cold",
            hasRefreshed: false
        )
        seedItem(userId: "u1", title: "task A")
        seedItem(userId: "u1", title: "task B")

        // Note: with the retry helper added in this PR, a single sticky 401 stub
        // is hit 4 times (1 initial + 3 retries) before refreshCurrentUser
        // applies the cold-launch lenience. This test asserts on the lenience
        // outcome (cached state preserved), not on the request count — both are
        // valid behaviors for the cold-launch path.
        MockURLProtocol.stub(url: usersMeURL(for: client), statusCode: 401, body: Data())

        await manager.refreshCurrentUser()

        #expect(manager.token == "tok-cold", "first-of-process 401 must NOT clear the token")
        #expect(manager.currentUser?.id == "u1", "currentUser stays so the UI doesn't flicker out")
        #expect(manager.isAuthenticated, "auth gate stays past login on a transient launch 401")
        #expect(itemCount() == 2, "cold-launch 401 must NOT wipe local data — that was the regression")
    }

    /// Mirror of the above for the foreground-keepalive path
    /// (`refreshIfStale` → `/api/auth/ios/session`). Both refresh paths
    /// fire on cold launch so both need the lenience gate.
    @Test func coldLaunchIOSSession401KeepsTokenAndPreservesData() async {
        resetState()
        defer { resetState() }

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
        manager.injectFakeSession(
            user: AuthUser(id: "u1", email: "u1@x.com"),
            token: "tok-cold",
            hasRefreshed: false
        )
        seedItem(userId: "u1", title: "task A")

        // Note: with the retry helper added in this PR, a single sticky 401 stub
        // is hit 4 times (1 initial + 3 retries) before refreshIfStale applies
        // the cold-launch lenience. This test asserts on the lenience outcome
        // (cached state preserved), not on the request count — both are valid
        // behaviors for the cold-launch path.
        MockURLProtocol.stub(url: iosSessionURL(for: client), statusCode: 401, body: Data())

        await manager.refreshIfStale()

        #expect(manager.token == "tok-cold")
        #expect(manager.isAuthenticated)
        #expect(itemCount() == 1)
    }

    // MARK: - Retry on unauthorized (refreshIfStale)

    /// After exhausting all retries, `refreshIfStale` escalates to
    /// `clearInvalidSession` the same way a bare 401 did before retry was
    /// added — we just try harder first.
    @Test("refreshIfStale retries 3 times on /api/auth/ios/session 401 before signing out")
    func refreshIfStaleRetriesThenSignsOut() async {
        resetState()
        defer { resetState() }

        let (mgr, client) = makeTestManager()
        mgr.injectFakeSession(
            user: AuthUser(id: "u1", email: "a@b.com", name: nil,
                           avatarUrl: nil, timezone: "UTC", assistantName: "Brett"),
            token: "tok",
            hasRefreshed: true
        )

        MockURLProtocol.stub(url: iosSessionURL(for: client), statusCode: 401, body: Data())
        MockURLProtocol.stub(url: signOutURL(for: client), statusCode: 200, body: Data())

        await mgr.refreshIfStale(threshold: 0)

        #expect(mgr.token == nil, "exhausted retries must escalate to clearInvalidSession")
        let sessionRequests = MockURLProtocol.recordedRequests()
            .filter { $0.url?.path.hasSuffix("/api/auth/ios/session") == true }
        #expect(sessionRequests.count == 4, "1 initial attempt + 3 retries = 4 total requests")
    }

    /// If any retry succeeds, the session is preserved — the user stays
    /// signed in without any visible disruption.
    @Test("refreshIfStale recovers when one retry succeeds after 401s")
    func refreshIfStaleRecoversAfterRetry() async {
        resetState()
        defer { resetState() }

        let (mgr, client) = makeTestManager()
        mgr.injectFakeSession(
            user: AuthUser(id: "u1", email: "a@b.com", name: nil,
                           avatarUrl: nil, timezone: "UTC", assistantName: "Brett"),
            token: "tok",
            hasRefreshed: true
        )

        let unauth = MockURLProtocol.Stub.response(statusCode: 401, body: Data())
        // ISO 8601 without fractional seconds — matches the decoder's .iso8601 strategy.
        let okBody = Data(#"{"token":"tok","expiresAt":"2099-01-01T00:00:00Z","user":{"id":"u1","email":"a@b.com"}}"#.utf8)
        let ok = MockURLProtocol.Stub.response(statusCode: 200, body: okBody)
        MockURLProtocol.stubSequence(
            url: iosSessionURL(for: client),
            responses: [unauth, unauth, unauth, ok]
        )

        await mgr.refreshIfStale(threshold: 0)

        #expect(mgr.token == "tok", "session preserved — retry succeeded before exhaustion")
    }

    /// Non-401 errors (transport failures, timeouts) must NOT be retried —
    /// only `APIError.unauthorized` triggers the backoff loop.
    @Test("refreshIfStale does not retry on non-401 errors")
    func refreshIfStaleDoesNotRetryOnNetworkError() async {
        resetState()
        defer { resetState() }

        let (mgr, client) = makeTestManager()
        mgr.injectFakeSession(
            user: AuthUser(id: "u1", email: "a@b.com", name: nil,
                           avatarUrl: nil, timezone: "UTC", assistantName: "Brett"),
            token: "tok",
            hasRefreshed: true
        )

        MockURLProtocol.stub(
            url: iosSessionURL(for: client),
            error: URLError(.notConnectedToInternet)
        )

        await mgr.refreshIfStale(threshold: 0)

        // Network errors leave state intact (the outer catch-all in
        // refreshIfStale keeps cached state on transient failures).
        #expect(mgr.token == "tok", "transport error must NOT clear the session")
        let requests = MockURLProtocol.recordedRequests()
            .filter { $0.url?.path.hasSuffix("/api/auth/ios/session") == true }
        #expect(requests.count == 1, "transport errors are not retried — exactly 1 request")
    }

    // MARK: - Post-success escalation

    /// Once the process HAS successfully validated a session, a subsequent
    /// 401 is taken at face value: clear the keychain and active session,
    /// but leave SwiftData alone (same person, just needs to re-auth).
    @Test func usersMe401AfterSuccessClearsAuthButPreservesData() async {
        resetState()
        defer { resetState() }

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
        manager.injectFakeSession(
            user: AuthUser(id: "u1", email: "u1@x.com"),
            token: "tok-1",
            hasRefreshed: true
        )
        seedItem(userId: "u1", title: "cached task")

        MockURLProtocol.stub(url: usersMeURL(for: client), statusCode: 401, body: Data())
        MockURLProtocol.stub(url: signOutURL(for: client), statusCode: 200, body: Data())

        await manager.refreshCurrentUser()

        #expect(manager.token == nil, "post-success 401 escalates and clears the token")
        #expect(manager.currentUser == nil)
        #expect(!manager.isAuthenticated, "UI gate flips back to SignInView")
        #expect(itemCount() == 1, "clearInvalidSession must NOT wipe local data — that's signOut's job")
    }

    // MARK: - Retry on unauthorized

    /// After exhausting all retries, `refreshCurrentUser` escalates to
    /// `clearInvalidSession` the same way a bare 401 did before retry was
    /// added — we just try harder first.
    @Test("refreshCurrentUser retries 3 times on /users/me 401 before signing out")
    func refreshCurrentUserRetriesThenSignsOut() async {
        resetState()
        defer { resetState() }

        let (mgr, client) = makeTestManager()
        mgr.injectFakeSession(
            user: AuthUser(id: "u1", email: "a@b.com", name: nil,
                           avatarUrl: nil, timezone: "UTC", assistantName: "Brett"),
            token: "tok",
            hasRefreshed: true
        )

        MockURLProtocol.stub(url: usersMeURL(for: client), statusCode: 401, body: Data())
        MockURLProtocol.stub(url: signOutURL(for: client), statusCode: 200, body: Data())

        await mgr.refreshCurrentUser()

        #expect(mgr.token == nil, "exhausted retries must escalate to clearInvalidSession")
        let usersMeRequests = MockURLProtocol.recordedRequests()
            .filter { $0.url?.path.hasSuffix("/users/me") == true }
        #expect(usersMeRequests.count == 4, "1 initial attempt + 3 retries = 4 total requests")
    }

    /// If any retry succeeds, the session is preserved — the user stays
    /// signed in without any visible disruption.
    @Test("refreshCurrentUser recovers when one retry succeeds after 401s")
    func refreshCurrentUserRecoversAfterRetry() async {
        resetState()
        defer { resetState() }

        let (mgr, client) = makeTestManager()
        mgr.injectFakeSession(
            user: AuthUser(id: "u1", email: "a@b.com", name: nil,
                           avatarUrl: nil, timezone: "UTC", assistantName: "Brett"),
            token: "tok",
            hasRefreshed: true
        )

        let unauth = MockURLProtocol.Stub.response(statusCode: 401, body: Data())
        let ok = MockURLProtocol.Stub.response(
            statusCode: 200,
            body: validUserMeBody(id: "u1", email: "a@b.com")
        )
        MockURLProtocol.stubSequence(
            url: usersMeURL(for: client),
            responses: [unauth, unauth, unauth, ok]
        )

        await mgr.refreshCurrentUser()

        #expect(mgr.token == "tok", "session preserved — retry succeeded before exhaustion")
        #expect(mgr.currentUser?.id == "u1", "user record updated from the successful retry response")
    }

    /// Non-401 errors (transport failures, timeouts) must NOT be retried —
    /// only `APIError.unauthorized` triggers the backoff loop.
    @Test("refreshCurrentUser does not retry on non-401 errors")
    func refreshCurrentUserDoesNotRetryOnNetworkError() async {
        resetState()
        defer { resetState() }

        let (mgr, client) = makeTestManager()
        mgr.injectFakeSession(
            user: AuthUser(id: "u1", email: "a@b.com", name: nil,
                           avatarUrl: nil, timezone: "UTC", assistantName: "Brett"),
            token: "tok",
            hasRefreshed: true
        )

        MockURLProtocol.stub(url: usersMeURL(for: client), error: URLError(.notConnectedToInternet))

        await mgr.refreshCurrentUser()

        // Network errors leave state intact (the outer catch-all in
        // refreshCurrentUser keeps cached state on transient failures).
        #expect(mgr.token == "tok", "transport error must NOT clear the session")
        let requests = MockURLProtocol.recordedRequests()
            .filter { $0.url?.path.hasSuffix("/users/me") == true }
        #expect(requests.count == 1, "transport errors are not retried — exactly 1 request")
    }

    /// `clearInvalidSession` deliberately leaves `lastSignedInUserId` in
    /// place so the next `persist(session:)` can detect a user-switch and
    /// wipe defensively. Without that, signing in as a different user
    /// would render the prior user's items until sync overwrites them.
    @Test func clearInvalidSessionPreservesUserSwitchSentinel() async {
        resetState()
        defer { resetState() }

        SharedConfig.writeLastSignedInUserId("u1")

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
        manager.injectFakeSession(
            user: AuthUser(id: "u1", email: "u1@x.com"),
            token: "tok-1",
            hasRefreshed: true
        )

        MockURLProtocol.stub(url: usersMeURL(for: client), statusCode: 401, body: Data())
        MockURLProtocol.stub(url: signOutURL(for: client), statusCode: 200, body: Data())

        await manager.refreshCurrentUser()

        #expect(SharedConfig.resolveLastSignedInUserId() == "u1",
                "lastSignedInUserId must survive clearInvalidSession so the next persist() can detect a user switch")
    }

    // MARK: - User-initiated signOut

    @Test func userInitiatedSignOutWipesData() async {
        resetState()
        defer { resetState() }

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
        manager.injectFakeSession(
            user: AuthUser(id: "u1", email: "u1@x.com"),
            token: "tok-1",
            hasRefreshed: true
        )
        seedItem(userId: "u1", title: "task A")
        seedItem(userId: "u1", title: "task B")
        #expect(itemCount() == 2)

        MockURLProtocol.stub(url: signOutURL(for: client), statusCode: 200, body: Data())

        await manager.signOut()

        #expect(manager.token == nil)
        #expect(manager.currentUser == nil)
        #expect(!manager.isAuthenticated)
        #expect(itemCount() == 0, "signOut() is the user-initiated path and DOES wipe")
    }

    @Test func userInitiatedSignOutClearsUserSwitchSentinel() async {
        resetState()
        defer { resetState() }

        SharedConfig.writeLastSignedInUserId("u1")

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
        manager.injectFakeSession(
            user: AuthUser(id: "u1", email: "u1@x.com"),
            token: "tok-1",
            hasRefreshed: true
        )

        MockURLProtocol.stub(url: signOutURL(for: client), statusCode: 200, body: Data())

        await manager.signOut()

        #expect(SharedConfig.resolveLastSignedInUserId() == nil,
                "deliberate sign-out resets the sentinel — a future same-user re-sign-in is not a switch")
    }

    @Test func signOutClearsHasRefreshedFlagSoNextProcessGetsLenience() async {
        resetState()
        defer { resetState() }

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
        manager.injectFakeSession(
            user: AuthUser(id: "u1", email: "u1@x.com"),
            token: "tok-1",
            hasRefreshed: true
        )

        MockURLProtocol.stub(url: signOutURL(for: client), statusCode: 200, body: Data())
        await manager.signOut()

        // Re-inject (simulates re-sign-in via keychain hydrate path) WITHOUT
        // refreshing — the gate should be back to `false` so a 401 here
        // would be lenient again, not escalate using stale state from the
        // prior session.
        manager.injectFakeSession(
            user: AuthUser(id: "u2", email: "u2@x.com"),
            token: "tok-2",
            hasRefreshed: false
        )
        seedItem(userId: "u2", title: "fresh task")

        MockURLProtocol.stub(url: usersMeURL(for: client), statusCode: 401, body: Data())
        await manager.refreshCurrentUser()

        #expect(manager.token == "tok-2", "fresh-process 401 must be lenient, even after a prior signOut")
        #expect(itemCount() == 1)
    }

    // MARK: - Other-error tolerance

    /// Network blips (timeout, offline) on cold launch are already silent;
    /// pinning the behavior so the leniency change doesn't regress it.
    @Test func coldLaunchNetworkErrorKeepsState() async {
        resetState()
        defer { resetState() }

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
        manager.injectFakeSession(
            user: AuthUser(id: "u1", email: "u1@x.com"),
            token: "tok-1",
            hasRefreshed: false
        )
        seedItem(userId: "u1", title: "task A")

        MockURLProtocol.stub(url: usersMeURL(for: client), error: URLError(.notConnectedToInternet))

        await manager.refreshCurrentUser()

        #expect(manager.token == "tok-1")
        #expect(itemCount() == 1)
    }

    // MARK: - tokenProvider contract
    //
    // The Google provider used to overwrite `APIClient.shared.tokenProvider`
    // with a value-captured closure (`{ session.token }`) at sign-in. That
    // froze a single token: after sign-out the captured token would still
    // ship on every outgoing request even though `AuthManager.token` had
    // been cleared. This test pins the actual contract — AuthManager's
    // tokenProvider is set ONCE in init and chases the live `self.token`
    // across sign-in/sign-out cycles — so any future provider that
    // re-introduces the override regresses here.
    @Test func tokenProviderChasesCurrentTokenAcrossSignOut() async {
        resetState()
        defer { resetState() }

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)

        // Pre-condition: tokenProvider was wired in init.
        #expect(client.tokenProvider != nil, "AuthManager.init must install a tokenProvider")

        manager.injectFakeSession(
            user: AuthUser(id: "u1", email: "u1@x.com"),
            token: "live-token-1",
            hasRefreshed: true
        )
        #expect(client.tokenProvider?() == "live-token-1",
                "tokenProvider must read the freshly-injected token")

        // Sign-out clears manager.token. The closure is the SAME identity
        // (set once in init) and must reflect the cleared state.
        MockURLProtocol.stub(url: signOutURL(for: client), statusCode: 200, body: Data())
        await manager.signOut()
        #expect(client.tokenProvider?() == nil,
                "after signOut the tokenProvider must chase to nil — not return a stale captured value")

        // Sign in as a different user. Same closure, same chase.
        manager.injectFakeSession(
            user: AuthUser(id: "u2", email: "u2@x.com"),
            token: "live-token-2",
            hasRefreshed: true
        )
        #expect(client.tokenProvider?() == "live-token-2",
                "tokenProvider must reflect the new user's token after re-injection")
    }

    // MARK: - Defensive wipe on missing sentinel

    /// Sentinel is missing AND non-empty local data exists → wipe.
    /// This is the App-Group-misconfigured / post-uninstall-reinstall /
    /// sentinel-migration-race path: we can't prove the leftover rows
    /// belong to the incoming user, so they must go.
    @Test func persistWithMissingSentinelAndExistingDataWipes() async throws {
        resetState()
        defer { resetState() }

        // Sentinel is intentionally absent (resetState already cleared it).
        #expect(SharedConfig.resolveLastSignedInUserId() == nil)

        // Seed leftover rows from a prior session. These could be from
        // any user; without the sentinel we can't tell.
        seedItem(userId: "unknown-prior-user", title: "leftover")
        seedItem(userId: "unknown-prior-user", title: "another leftover")
        #expect(itemCount() == 2)

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
        // Stub /users/me so the post-persist hydrate doesn't blow up.
        MockURLProtocol.stub(
            url: usersMeURL(for: client),
            statusCode: 200,
            body: validUserMeBody(id: "u-new", email: "new@x.com")
        )

        let session = AuthSession(
            token: "tok-new",
            user: AuthUser(id: "u-new", email: "new@x.com")
        )
        try await manager.persistForTesting(session: session)

        #expect(itemCount() == 0,
                "missing-sentinel + non-empty data must trigger defensive wipe")
        #expect(SharedConfig.resolveLastSignedInUserId() == "u-new",
                "persist should also stamp the sentinel for next time")
    }

    /// Sentinel is missing AND device is clean → no wipe needed (no-op).
    /// Fresh install path: nothing to wipe, sign-in proceeds normally.
    @Test func persistWithMissingSentinelAndCleanDeviceDoesNotWipe() async throws {
        resetState()
        defer { resetState() }

        #expect(SharedConfig.resolveLastSignedInUserId() == nil)
        #expect(itemCount() == 0)

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
        MockURLProtocol.stub(
            url: usersMeURL(for: client),
            statusCode: 200,
            body: validUserMeBody(id: "u-fresh", email: "fresh@x.com")
        )

        let session = AuthSession(
            token: "tok-fresh",
            user: AuthUser(id: "u-fresh", email: "fresh@x.com")
        )
        try await manager.persistForTesting(session: session)

        // No wipe was needed. Sentinel is now set.
        #expect(SharedConfig.resolveLastSignedInUserId() == "u-fresh")
    }

    /// Sentinel matches the incoming user → warm cache preserved (no wipe).
    /// Same-user re-sign-in after token expiry: keep their data.
    @Test func persistWithMatchingSentinelPreservesData() async throws {
        resetState()
        defer { resetState() }

        SharedConfig.writeLastSignedInUserId("u-same")
        seedItem(userId: "u-same", title: "warm cache item")
        #expect(itemCount() == 1)

        let client = makeTestClient()
        let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
        MockURLProtocol.stub(
            url: usersMeURL(for: client),
            statusCode: 200,
            body: validUserMeBody(id: "u-same", email: "same@x.com")
        )

        let session = AuthSession(
            token: "tok-same",
            user: AuthUser(id: "u-same", email: "same@x.com")
        )
        try await manager.persistForTesting(session: session)

        #expect(itemCount() == 1, "same-user re-sign-in keeps cached data warm")
    }

    // MARK: - Keychain write failure during sign-in

    /// Verifies that `persist(session:)` throws when the token is empty,
    /// which is the path exercised when `writeToken("")` rejects the value.
    /// The `runSignIn` catch block translates this `KeychainStore.KeychainError`
    /// into `APIError.keychainWriteFailed.userFacingMessage` — the mapping
    /// itself is a 3-line direct translation whose correctness is enforced by
    /// compiler exhaustiveness on the `KeychainError` catch pattern.
    ///
    /// Note: directly injecting a `KeychainStore` write failure into
    /// `runSignIn` would require a protocol-based `KeychainStoring` abstraction
    /// that does not exist yet (out of scope for this task). The empty-token
    /// path is the one production trigger for `KeychainError.unexpectedData`
    /// from `writeToken`, so testing it here plus the unit test in
    /// `KeychainEdgeTests` provides strong coverage of the production failure
    /// mode.
    @Test("persist with empty token throws KeychainError")
    @MainActor
    func persistEmptyTokenThrows() async {
        resetState()
        defer { resetState() }

        let (mgr, _) = makeTestManager()

        do {
            try await mgr.persistForTesting(
                session: AuthSession(
                    token: "",
                    user: AuthUser(id: "u1", email: "a@b.com", name: nil,
                                   avatarUrl: nil, timezone: "UTC", assistantName: "Brett")
                )
            )
            Issue.record("expected persist to throw on empty token")
        } catch let kc as KeychainStore.KeychainError {
            // Expected — writeToken("") throws KeychainError.unexpectedData.
            // runSignIn translates this into APIError.keychainWriteFailed.userFacingMessage.
            _ = kc // Suppress unused-variable warning; the catch pattern is what matters.
        } catch {
            Issue.record("expected KeychainStore.KeychainError but got \(error)")
        }
    }

    // MARK: - SessionExpiryHint lifecycle

    @Test("SessionExpiryHint is set on persist, set on clearInvalidSession, cleared on signOut")
    @MainActor
    func sessionExpiryHintLifecycle() async throws {
        resetState()
        defer { resetState() }

        let (mgr, client) = makeTestManager()

        // Simulate a successful sign-in via persist:
        let user = AuthUser(id: "u1", email: "soft@example.com", name: nil,
                            avatarUrl: nil, timezone: "UTC", assistantName: "Brett")
        MockURLProtocol.stub(
            url: usersMeURL(for: client),
            statusCode: 200,
            body: validUserMeBody(id: "u1", email: "soft@example.com")
        )
        try await mgr.persistForTesting(session: AuthSession(token: "tok", user: user))
        #expect(SessionExpiryHint.lastEmail == "soft@example.com")
        #expect(SessionExpiryHint.didExpire == false)

        // Trigger clearInvalidSession via a post-refresh 401:
        MockURLProtocol.stub(url: usersMeURL(for: client), statusCode: 401, body: Data())
        MockURLProtocol.stub(url: signOutURL(for: client), statusCode: 200, body: Data())
        mgr.injectFakeSession(user: user, token: "tok", hasRefreshed: true)
        await mgr.refreshCurrentUser()

        #expect(mgr.token == nil)
        #expect(SessionExpiryHint.lastEmail == "soft@example.com") // preserved
        #expect(SessionExpiryHint.didExpire == true)               // flag set

        // User-initiated signOut should clear both:
        // (signOut needs a token + currentUser to do the full path; re-inject)
        mgr.injectFakeSession(user: user, token: "tok2", hasRefreshed: true)
        MockURLProtocol.stub(url: signOutURL(for: client), statusCode: 200, body: Data())
        await mgr.signOut()

        #expect(SessionExpiryHint.lastEmail == nil)
        #expect(SessionExpiryHint.didExpire == false)
    }

    // MARK: - hydrateFromKeychain

    /// Calling `hydrateFromKeychain` a second time must be a no-op when the
    /// token is already set. The Face-ID-ON post-unlock path may fire the
    /// `.onChange(of: authenticatedContext)` more than once (e.g. after a
    /// background→foreground→background→foreground cycle), and we must not
    /// overwrite the in-memory token with whatever is currently in the keychain.
    @Test("hydrateFromKeychain is idempotent — second call returns early when token is already set")
    @MainActor
    func hydrateFromKeychainIdempotent() async throws {
        resetState()
        defer { resetState() }
        try KeychainStore.writeToken("hydrate-test-tok")

        let (mgr, client) = makeTestManager()
        MockURLProtocol.stub(url: usersMeURL(for: client), statusCode: 200,
                             body: validUserMeBody(id: "u1", email: "a@b.com"))

        // First call hydrates.
        await mgr.hydrateFromKeychain(authContext: nil)
        #expect(mgr.token == "hydrate-test-tok")

        // Second call should no-op even if keychain contains a different token.
        try KeychainStore.writeToken("different-token")
        await mgr.hydrateFromKeychain(authContext: nil)
        #expect(mgr.token == "hydrate-test-tok", "second call must be a no-op — token is unchanged")
        #expect(!mgr.isHydratingFromKeychain, "flag should be false after both calls")
    }

    /// `hydrateFromKeychain` sets `isHydratingFromKeychain = false` via its
    /// `defer` block regardless of the outcome (token found, not found, or
    /// error). This ensures RootView never gets stuck showing BiometricLockView
    /// after the keychain read completes.
    @Test("hydrateFromKeychain clears isHydratingFromKeychain on completion")
    @MainActor
    func hydrateFromKeychainClearsHydrationFlag() async throws {
        resetState()
        defer { resetState() }

        let (mgr, client) = makeTestManager()
        // No stub needed for /users/me — no token in keychain so the guard
        // returns early before calling refreshCurrentUser. Just register the
        // URL so MockURLProtocol doesn't blow up if it is somehow hit.
        MockURLProtocol.stub(url: usersMeURL(for: client), statusCode: 200,
                             body: validUserMeBody(id: "u1", email: "a@b.com"))

        // Manually set the flag to simulate Face-ID-ON init path.
        // (In production this is done inside init(); we set it directly here
        // to avoid relying on UserDefaults state in tests.)
        mgr.testSetHydratingFromKeychain(true)
        #expect(mgr.isHydratingFromKeychain)

        // No token in keychain — hydrateFromKeychain should return early
        // but still clear the flag via defer.
        await mgr.hydrateFromKeychain(authContext: nil)
        #expect(!mgr.isHydratingFromKeychain, "flag must be cleared even when no token is found")
    }

    @Test func hydrateTaskDoesNotRetainSelfAfterRelease() async throws {
        resetState()
        defer { resetState() }

        // Seed a token so the keychain-hydrate path actually fires the
        // implicit `Task { await self.refreshCurrentUser() }` in init.
        // Without a token in the keychain, the Task is never created and
        // the test is trivially green even when self is strongly captured.
        try KeychainStore.writeToken("hydrate-retain-test")

        let client = makeTestClient()
        // Stub /users/me with a slow response so the in-flight task is
        // alive while the manager goes out of scope. The mock doesn't
        // actually sleep, but having the stub registered means the call
        // resolves quickly and any retain-cycle issue would be unaffected.
        MockURLProtocol.stub(
            url: usersMeURL(for: client),
            statusCode: 200,
            body: validUserMeBody(id: "u1", email: "u1@x.com")
        )

        weak var weakManager: AuthManager?
        do {
            let manager = AuthManager(client: client, retryDelays: Self.testRetryDelays)
            weakManager = manager
            // Manager goes out of scope at end of `do` block.
        }
        // Yield enough times for the in-flight Task to finish and release
        // any strong ref. Two short sleeps cover both the request roundtrip
        // and the post-completion main-actor hops.
        try await Task.sleep(nanoseconds: 100_000_000)
        try await Task.sleep(nanoseconds: 100_000_000)
        #expect(weakManager == nil, "AuthManager should be deallocated after going out of scope")
    }
}
