import Foundation
import Observation
import SwiftData

/// Session-scoped runtime state. Created by `AuthManager` when a user signs
/// in, torn down on sign-out. Prevents the class of bug where a Task from a
/// previous user's session writes mutations into a new user's SwiftData
/// after an account switch.
///
/// Why not keep `SyncManager.shared`? A process-wide singleton outlives the
/// sign-in/sign-out boundary by design. Its `pendingDebouncedTask`, SSE
/// reconnect loop, and the in-flight network requests owned by its engines
/// can all continue producing writes after the auth state has flipped. The
/// only way to reliably end that chain is to release the owner. `Session`
/// is that owner.
///
/// AuthManager holds the current `Session` instance. Stores and views reach
/// it via `ActiveSession.syncManager` etc. — when no user is signed in those
/// accessors return nil, and optional-chained push/pull calls in the stores
/// are silent no-ops. Mutations enqueued during that gap persist to
/// `MutationQueueEntry` and get picked up by the next session's push.
@MainActor
final class Session {
    let userId: String

    /// This session's `SyncManager`. Bound to the shared `ModelContext` but
    /// owned by this instance — when the session is torn down, all its
    /// Tasks are cancelled and the engines are released.
    let syncManager: SyncManager

    /// SSE event handler scoped to this session's `SyncManager`. Holds a
    /// strong ref to the consumer Task; torn down with the session.
    private var sseHandler: SSEEventHandler?

    /// SSE client. Today this remains a process-wide shared instance
    /// (`SSEClient.shared`) because its reconnect loop + ticket refresh
    /// are non-trivial to migrate to session ownership. Wave B promotes
    /// the reconnect-counter reset and background-URLSession work and can
    /// take SSE fully session-owned at that point. Sign-out calls
    /// `disconnect()` here so no stale stream leaks into the next session.
    private let sseClient: SSEClient

    init(
        userId: String,
        persistence: PersistenceController,
        sseClient: SSEClient = .shared
    ) {
        self.userId = userId
        self.sseClient = sseClient

        let context = persistence.mainContext
        // Single background ModelActor shared by both engines so they
        // both write through the same on-actor context. SyncManager
        // serialises pull/push via a mutex, so there's no concurrent
        // write race; sharing also avoids the second allocation cost.
        let syncData = SyncDataActor(modelContainer: persistence.container)
        let pushEngine = PushEngine(
            mutationQueue: MutationQueue(context: context),
            syncData: syncData
        )
        let pullEngine = PullEngine(syncData: syncData)

        self.syncManager = SyncManager(
            pushEngine: SessionPushEngineAdapter(pushEngine),
            pullEngine: SessionPullEngineAdapter(pullEngine),
            networkMonitor: NetworkMonitor.shared,
            modelContext: context,
            // Wire SSE health into the poll loop so when the realtime
            // stream is delivering events the poll relaxes from 30s to
            // 120s — SSE is the realtime path; the poll is just a
            // safety net against silent SSE drops + missed-event gaps.
            // Falls back to fast 30s polls automatically when SSE drops
            // or after sync failures.
            sseHealthSignal: sseClient
        )
    }

    /// Begin pushing / pulling / listening for SSE on this session.
    /// Idempotent — `SyncManager.start()` guards against double-start.
    func start() {
        syncManager.start()

        let handler = SSEEventHandler(sseClient: sseClient, syncTrigger: syncManager)
        handler.start()
        sseHandler = handler

        sseClient.connect()
    }

    /// Deterministic teardown. Called from `AuthManager.signOut` /
    /// `clearInvalidSession()` before SwiftData is wiped, so any in-flight
    /// push/pull completes (or is cancelled) before the underlying rows
    /// disappear.
    ///
    /// Order matters:
    ///   1. Clear every `Clearable` store. The fan-out invokes
    ///      `ChatStore.clearForSignOut()` — which cancels every in-flight
    ///      chat stream — along with any other store that caches derived
    ///      state in memory. A stream that's mid-response when the user
    ///      signs out would otherwise land its final `persistAssistant`
    ///      against the NEXT user's SwiftData context.
    ///   2. Disconnect SSE so no new events arrive.
    ///   3. Stop the sync manager so its poll loop ends.
    ///   4. Clear the process-wide `RemoteCache` synchronously. Previously
    ///      a `Task.detached` here could land after the next session began
    ///      writing — a fast sign-out → sign-in (token rotation, account
    ///      switch on a shared device) would lose the new session's first
    ///      cache entries to the prior session's clear.
    func tearDown() async {
        // Clear in-memory store caches first. SwiftData rows still exist at
        // this point — `wipeAllData()` runs in `AuthManager.signOut` *after*
        // we return — but stores that cache derived state in memory must
        // drop it now so a stream/network completion arriving in the next
        // few ms can't repopulate them with the prior user's data.
        // Notably, ChatStore.clearForSignOut() cancels every in-flight chat
        // stream as part of the fan-out.
        ClearableStoreRegistry.clearAll()
        sseClient.disconnect()
        sseHandler?.stop()
        sseHandler = nil
        syncManager.stop()
        // Drop on-demand cache entries (chat history, event notes, etc.)
        // before returning so the next session install can't observe
        // previous-session entries. `await` is critical — see doc above.
        await RemoteCache.shared.clear()
    }

    #if DEBUG
    /// Sync subset of `tearDown` for `ActiveSession.endForTesting`. Skips
    /// the async `RemoteCache.clear` because tests don't observe the
    /// cross-session cache race. `ClearableStoreRegistry.clearAll()` runs
    /// in the caller (`endForTesting`) so this method only handles the
    /// per-session cleanup.
    func disconnectForTesting() {
        sseClient.disconnect()
        sseHandler?.stop()
        sseHandler = nil
        syncManager.stop()
    }
    #endif
}

/// Static registry of the currently-authenticated session. Updated by
/// `AuthManager`; read by stores, views, and the share extension drain.
@MainActor
enum ActiveSession {
    private(set) static var current: Session?

    /// Install a new session, tearing down any previous one. Called by
    /// `AuthManager` on sign-in (including the "already signed in at
    /// launch" path that hydrates from Keychain). `async` so `tearDown`'s
    /// `RemoteCache.clear()` completes before the new session can write.
    static func begin(_ session: Session) async {
        if let existing = current {
            await existing.tearDown()
        }
        current = session
        session.start()
    }

    /// Release the current session. Called by `AuthManager.signOut` /
    /// `clearInvalidSession` before they clear the token and wipe SwiftData.
    static func end() async {
        await current?.tearDown()
        current = nil
    }

    #if DEBUG
    /// Test-only synchronous cleanup. Fires the same teardown work, but
    /// drops the `RemoteCache.clear()` await — tests don't observe the
    /// cross-session cache race that the production await guards against,
    /// and keeping the call sync lets test suites continue to use the
    /// `defer { resetState() }` pattern (defer can't `await`).
    @MainActor
    static func endForTesting() {
        if let session = current {
            ClearableStoreRegistry.clearAll()
            session.disconnectForTesting()
        }
        current = nil
    }
    #endif

    // MARK: - Convenience accessors

    /// Shortcut for the common caller pattern:
    /// `ActiveSession.syncManager?.schedulePushDebounced()`. Returns nil
    /// when no user is signed in — callers silently no-op, which is the
    /// correct behaviour (nothing to sync without an account).
    static var syncManager: SyncManager? { current?.syncManager }

    static var userId: String? {
        #if DEBUG
        if let fake = fakeUserIdForTesting { return fake }
        #endif
        return current?.userId
    }

    #if DEBUG
    /// Test-only: directly seed `userId` without constructing a real
    /// `Session`. Store tests that need an authenticated context but
    /// don't want to start sync engines (which `Session.start()` does)
    /// call this in setup. Pair with `endTestingSession()` in teardown
    /// to avoid leaks across test cases.
    static func installFakeUserIdForTesting(_ userId: String) {
        fakeUserIdForTesting = userId
    }

    /// Test-only counterpart to `installFakeUserIdForTesting`.
    static func endTestingSession() {
        fakeUserIdForTesting = nil
    }

    private static var fakeUserIdForTesting: String?
    #endif
}

// MARK: - Engine adapters

/// Session-owned `PushEngine` wrapper. The previous `DefaultPushEngine.shared`
/// bound the engine to a process-wide singleton, which leaked across sign-outs.
@MainActor
private final class SessionPushEngineAdapter: PushEngineProtocol {
    private let real: PushEngine
    init(_ real: PushEngine) { self.real = real }
    func push() async throws -> PushEngine.PushOutcome {
        try await real.push()
    }
}

@MainActor
private final class SessionPullEngineAdapter: PullEngineProtocol {
    private let real: PullEngine
    init(_ real: PullEngine) { self.real = real }
    func pull() async throws -> PullEngine.PullOutcome {
        try await real.pull()
    }
}
