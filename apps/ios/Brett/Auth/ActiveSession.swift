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
        let pushEngine = PushEngine(mutationQueue: MutationQueue(context: context))
        let pullEngine = PullEngine()

        self.syncManager = SyncManager(
            pushEngine: SessionPushEngineAdapter(pushEngine),
            pullEngine: SessionPullEngineAdapter(pullEngine),
            networkMonitor: NetworkMonitor.shared,
            modelContext: context
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

    /// Deterministic teardown. Called synchronously from `AuthManager.signOut`
    /// before it wipes SwiftData, so any in-flight push/pull completes (or is
    /// cancelled) before the underlying rows disappear.
    ///
    /// Order matters:
    ///   1. Cancel every in-flight chat stream. A stream that's mid-response
    ///      when the user signs out would otherwise land its final
    ///      `persistAssistant` against the NEXT user's SwiftData context.
    ///   2. Disconnect SSE so no new events arrive.
    ///   3. Stop the sync manager so its poll loop ends.
    func tearDown() {
        ChatStoreRegistry.cancelAllActive()
        sseClient.disconnect()
        sseHandler?.stop()
        sseHandler = nil
        syncManager.stop()
    }
}

/// Static registry of the currently-authenticated session. Updated by
/// `AuthManager`; read by stores, views, and the share extension drain.
@MainActor
enum ActiveSession {
    private(set) static var current: Session?

    /// Install a new session, tearing down any previous one. Called by
    /// `AuthManager` on sign-in (including the "already signed in at
    /// launch" path that hydrates from Keychain).
    static func begin(_ session: Session) {
        if let existing = current {
            existing.tearDown()
        }
        current = session
        session.start()
    }

    /// Release the current session. Called by `AuthManager.signOut` before
    /// it clears the token and wipes SwiftData.
    static func end() {
        current?.tearDown()
        current = nil
    }

    // MARK: - Convenience accessors

    /// Shortcut for the common caller pattern:
    /// `ActiveSession.syncManager?.schedulePushDebounced()`. Returns nil
    /// when no user is signed in — callers silently no-op, which is the
    /// correct behaviour (nothing to sync without an account).
    static var syncManager: SyncManager? { current?.syncManager }

    static var userId: String? { current?.userId }
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
