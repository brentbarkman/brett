import Foundation
import Observation
import SwiftData

// MARK: - Local protocol stubs for parallel Wave-2 agents

/// Shape of a push result. Kept minimal so the concrete `PushEngine` from
/// W2-B can drop in without any call-site changes. Real fields (successCount,
/// errors, etc.) can be added without breaking the SyncManager contract.
struct PushOutcome: Sendable {
    var applied: Int
    var failed: Int

    init(applied: Int = 0, failed: Int = 0) {
        self.applied = applied
        self.failed = failed
    }
}

/// Shape of a pull result. See `PushOutcome`.
struct PullOutcome: Sendable {
    var upserted: Int
    var deleted: Int

    init(upserted: Int = 0, deleted: Int = 0) {
        self.upserted = upserted
        self.deleted = deleted
    }
}

/// The `PushEngine` surface SyncManager depends on. Defined here so this file
/// compiles even when the real `PushEngine.swift` hasn't landed yet. When it
/// does land, make `PushEngine` conform to this protocol.
@MainActor
protocol PushEngineProtocol: AnyObject {
    func push() async throws -> PushOutcome
}

/// The `PullEngine` surface SyncManager depends on. See `PushEngineProtocol`.
@MainActor
protocol PullEngineProtocol: AnyObject {
    func pull() async throws -> PullOutcome
}

// MARK: - Sync state

/// UI-facing state of the sync engine. Used by `SyncStatusIndicator`.
enum SyncState: Equatable, Sendable {
    case idle
    case pushing
    case pulling
    case error(String)
}

// MARK: - Sync manager

/// Orchestrates the push/pull sync cycle on top of the push and pull engines.
///
/// Responsibilities:
///  - Serialise sync attempts so two concurrent callers don't race.
///  - Debounce rapid mutation → push calls into a single sync.
///  - React to network transitions: online → trigger sync, offline → cancel
///    any pending debounced push.
///  - Keep an @Observable `state` and `lastSyncedAt` for the status indicator.
///  - On app launch, reset any mutations left in `in_flight` status from a
///    prior crash so they get retried.
///  - Run a best-effort 30s background poll while the app is in foreground.
@MainActor
@Observable
final class SyncManager {
    // MARK: - Shared instance

    /// Default singleton wired to the real engines. Tests should construct a
    /// fresh instance with their own doubles rather than touching `.shared`.
    static let shared = SyncManager()

    // MARK: - Observable state

    private(set) var state: SyncState = .idle
    private(set) var lastSyncedAt: Date?

    // MARK: - Dependencies

    private let pushEngine: PushEngineProtocol
    private let pullEngine: PullEngineProtocol
    private let networkMonitor: NetworkMonitor
    private let modelContext: ModelContext?

    /// Interval for the periodic foreground poll. Exposed so tests can use a
    /// much shorter value. Defaults to 30 seconds per the spec.
    private let pollInterval: TimeInterval

    /// Debounce window applied to `schedulePushDebounced`. Defaults to 1s.
    private let debounceInterval: TimeInterval

    // MARK: - Private state

    /// Mutex flag — `true` while a push+pull cycle is running.
    private var isSyncing = false

    /// Task driving the in-flight debounced push. Replaced whenever a new
    /// debounced call arrives, which implicitly cancels the previous wait.
    private var pendingDebouncedTask: Task<Void, Never>?

    /// Task listening for online/offline transitions. Cancelled on deinit /
    /// sign-out so we don't leak across accounts.
    private var networkListenerTask: Task<Void, Never>?

    /// Task running the periodic foreground poll.
    private var pollTask: Task<Void, Never>?

    /// True after `start()` has been called once; guards against double-start
    /// if the auth state flips rapidly at launch.
    private var hasStarted = false

    // MARK: - Init

    /// Production initialiser — wires to real engines and the shared network
    /// monitor. Tests should use the parameterised initialiser instead.
    convenience init() {
        self.init(
            pushEngine: DefaultPushEngine.shared,
            pullEngine: DefaultPullEngine.shared,
            networkMonitor: NetworkMonitor.shared,
            modelContext: PersistenceController.shared.mainContext,
            pollInterval: 30,
            debounceInterval: 1.0
        )
    }

    init(
        pushEngine: PushEngineProtocol,
        pullEngine: PullEngineProtocol,
        networkMonitor: NetworkMonitor,
        modelContext: ModelContext?,
        pollInterval: TimeInterval = 30,
        debounceInterval: TimeInterval = 1.0
    ) {
        self.pushEngine = pushEngine
        self.pullEngine = pullEngine
        self.networkMonitor = networkMonitor
        self.modelContext = modelContext
        self.pollInterval = pollInterval
        self.debounceInterval = debounceInterval
    }

    deinit {
        // Tasks hold weak refs to self, so cancelling here is strictly
        // belt-and-braces. Can't touch main-actor-isolated properties from a
        // nonisolated deinit — callers should invoke `stop()` explicitly when
        // they want deterministic teardown (e.g. on sign-out).
    }

    // MARK: - Lifecycle

    /// Call on app launch (or when auth becomes true). Idempotent — second
    /// calls are no-ops. Performs crash recovery, wires the network listener,
    /// and kicks off an initial sync if online.
    func start() {
        guard !hasStarted else { return }
        hasStarted = true

        resetInFlightMutations()
        attachNetworkListener()
        startForegroundPoll()

        if networkMonitor.isOnline {
            Task { @MainActor [weak self] in
                await self?.sync()
            }
        }
    }

    /// Tear down listeners + active tasks. Used when signing out so a new user
    /// doesn't inherit the previous user's background tasks.
    func stop() {
        networkListenerTask?.cancel()
        networkListenerTask = nil
        pollTask?.cancel()
        pollTask = nil
        pendingDebouncedTask?.cancel()
        pendingDebouncedTask = nil
        hasStarted = false
    }

    // MARK: - Core sync

    /// Run a full push → pull cycle, mutex-locked. Skips entirely if offline.
    /// Exceptions are logged into `state` but do not propagate; callers that
    /// need to surface errors should use `pullToRefresh` instead.
    func sync() async {
        // Bail if we're offline — nothing to push, and a pull would just fail.
        guard networkMonitor.isOnline else { return }

        // Mutex: reject re-entrant calls rather than queuing them. If a second
        // sync is needed it'll be picked up by the next debounced push or poll.
        guard !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }

        var firstError: String?

        // Phase 1: push. Capture errors but still attempt the pull so a one-off
        // push hiccup doesn't block incoming server changes indefinitely.
        state = .pushing
        do {
            _ = try await pushEngine.push()
        } catch {
            firstError = describe(error)
        }

        // Phase 2: pull. Always attempted so the server has the final say on
        // state even if our push stalled.
        state = .pulling
        do {
            _ = try await pullEngine.pull()
            lastSyncedAt = Date()
        } catch {
            // Preserve the push error if we had one — it's the more actionable
            // signal (a push failure means local mutations haven't landed).
            firstError = firstError ?? describe(error)
        }

        // Final state reflects whether either phase errored.
        if let message = firstError {
            state = .error(message)
        } else {
            state = .idle
        }
    }

    /// Explicit user-triggered refresh — throws so a pull-to-refresh gesture
    /// can surface the error inline. Still respects the mutex.
    func pullToRefresh() async throws {
        guard networkMonitor.isOnline else {
            throw SyncError.offline
        }

        guard !isSyncing else {
            throw SyncError.alreadyRunning
        }
        isSyncing = true
        defer { isSyncing = false }

        state = .pushing
        do {
            _ = try await pushEngine.push()
        } catch {
            state = .error(describe(error))
            throw error
        }

        state = .pulling
        do {
            _ = try await pullEngine.pull()
            state = .idle
            lastSyncedAt = Date()
        } catch {
            state = .error(describe(error))
            throw error
        }
    }

    // MARK: - Debounced push

    /// Collapse a burst of local mutations into a single sync. Each call
    /// cancels the previously scheduled task and starts a fresh
    /// `debounceInterval`-second sleep; the sync only runs once the caller
    /// stops hitting this method. Safe to call from any store's mutation path.
    func schedulePushDebounced() {
        // Cancel the previous waiter so only the latest call actually fires.
        pendingDebouncedTask?.cancel()

        pendingDebouncedTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await Task.sleep(nanoseconds: UInt64(self.debounceInterval * 1_000_000_000))
            } catch {
                // Cancelled — a newer debounced call superseded us.
                return
            }
            // Check for cancellation once more in case we got cancelled after
            // the sleep completed.
            if Task.isCancelled { return }
            await self.sync()
        }
    }

    // MARK: - Network listener

    /// Subscribe to online/offline transitions. Online → sync. Offline →
    /// cancel any pending debounced push so it doesn't fire once we reconnect
    /// with stale state (the online transition itself will trigger a fresh one).
    private func attachNetworkListener() {
        networkListenerTask?.cancel()
        networkListenerTask = Task { @MainActor [weak self] in
            guard let self else { return }
            for await isOnline in self.networkMonitor.onlineTransitions() {
                if isOnline {
                    await self.sync()
                } else {
                    self.pendingDebouncedTask?.cancel()
                    self.pendingDebouncedTask = nil
                }
            }
        }
    }

    // MARK: - Foreground poll

    /// 30-second auto-poll while the app is in the foreground. Uses `Task.sleep`
    /// so it naturally pauses when iOS suspends the app. Cancellation stops it
    /// cleanly via `stop()`.
    private func startForegroundPoll() {
        pollTask?.cancel()
        pollTask = Task { @MainActor [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: UInt64(self.pollInterval * 1_000_000_000))
                } catch {
                    return
                }
                if Task.isCancelled { return }
                if self.networkMonitor.isOnline {
                    await self.sync()
                }
            }
        }
    }

    // MARK: - Crash recovery

    /// On app launch, any mutation left in `in_flight` status belongs to a
    /// previous process that crashed mid-push. Flip them back to `pending` so
    /// the next push picks them up.
    private func resetInFlightMutations() {
        guard let context = modelContext else { return }
        let inFlight = MutationStatus.inFlight.rawValue
        var descriptor = FetchDescriptor<MutationQueueEntry>()
        descriptor.predicate = #Predicate { entry in
            entry.status == inFlight
        }
        guard let entries = try? context.fetch(descriptor), !entries.isEmpty else { return }

        let pending = MutationStatus.pending.rawValue
        for entry in entries {
            entry.status = pending
        }
        try? context.save()
    }

    // MARK: - Helpers

    private func describe(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? String(describing: error)
    }
}

// MARK: - SyncManager errors

enum SyncError: LocalizedError {
    case offline
    case alreadyRunning

    var errorDescription: String? {
        switch self {
        case .offline: return "You're offline — reconnect to sync."
        case .alreadyRunning: return "Sync is already in progress."
        }
    }
}

// MARK: - Default engine placeholders

/// Temporary standalone placeholders so the singleton `SyncManager.shared`
/// compiles even before W2-B's concrete engines land. Once the real types
/// exist and conform to `PushEngineProtocol`/`PullEngineProtocol`, swap the
/// `SyncManager.shared` wiring to point at them and delete these.
///
/// These engines are intentionally no-ops: they return empty outcomes without
/// hitting the network. That's strictly safer than a half-implemented engine.
@MainActor
private final class DefaultPushEngine: PushEngineProtocol {
    static let shared = DefaultPushEngine()
    func push() async throws -> PushOutcome { PushOutcome() }
}

@MainActor
private final class DefaultPullEngine: PullEngineProtocol {
    static let shared = DefaultPullEngine()
    func pull() async throws -> PullOutcome { PullOutcome() }
}
