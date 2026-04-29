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

    /// Reset every shared bit of state these tests touch. Idempotent and
    /// safe to call from `defer` blocks. Order matters — `ActiveSession`
    /// must be torn down before swapping the persistence container so any
    /// in-flight SyncManager Task can't write into the new container.
    private func resetState() {
        ActiveSession.end()
        try? KeychainStore.deleteToken()
        SharedConfig.clearLastSignedInUserId()
        SharedConfig.writeCurrentUserId(nil)
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

    // MARK: - Cold-launch lenience

    /// **Regression guard.** The original symptom: hard-kill on TestFlight,
    /// relaunch, /users/me 401s, signOut runs, SwiftData wipes, user lands
    /// on sign-in screen with no tasks. Fix: the first 401 of a fresh
    /// process is treated as transient.
    @Test func coldLaunchUsersMe401KeepsTokenAndPreservesData() async {
        resetState()
        defer { resetState() }

        let client = makeTestClient()
        let manager = AuthManager(client: client)
        // Cold-launch state: token in keychain, /users/me hasn't returned
        // yet, no successful refresh established this process.
        manager.injectFakeSession(
            user: AuthUser(id: "u1", email: "u1@x.com"),
            token: "tok-cold",
            hasRefreshed: false
        )
        seedItem(userId: "u1", title: "task A")
        seedItem(userId: "u1", title: "task B")

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
        let manager = AuthManager(client: client)
        manager.injectFakeSession(
            user: AuthUser(id: "u1", email: "u1@x.com"),
            token: "tok-cold",
            hasRefreshed: false
        )
        seedItem(userId: "u1", title: "task A")

        MockURLProtocol.stub(url: iosSessionURL(for: client), statusCode: 401, body: Data())

        await manager.refreshIfStale()

        #expect(manager.token == "tok-cold")
        #expect(manager.isAuthenticated)
        #expect(itemCount() == 1)
    }

    // MARK: - Post-success escalation

    /// Once the process HAS successfully validated a session, a subsequent
    /// 401 is taken at face value: clear the keychain and active session,
    /// but leave SwiftData alone (same person, just needs to re-auth).
    @Test func usersMe401AfterSuccessClearsAuthButPreservesData() async {
        resetState()
        defer { resetState() }

        let client = makeTestClient()
        let manager = AuthManager(client: client)
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

    /// `clearInvalidSession` deliberately leaves `lastSignedInUserId` in
    /// place so the next `persist(session:)` can detect a user-switch and
    /// wipe defensively. Without that, signing in as a different user
    /// would render the prior user's items until sync overwrites them.
    @Test func clearInvalidSessionPreservesUserSwitchSentinel() async {
        resetState()
        defer { resetState() }

        SharedConfig.writeLastSignedInUserId("u1")

        let client = makeTestClient()
        let manager = AuthManager(client: client)
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
        let manager = AuthManager(client: client)
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
        let manager = AuthManager(client: client)
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
        let manager = AuthManager(client: client)
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
        let manager = AuthManager(client: client)
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
            let manager = AuthManager(client: client)
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
