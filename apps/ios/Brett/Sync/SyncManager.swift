import Foundation
import Observation
import SwiftData

// MARK: - Engine protocols

/// The push engine surface that `SyncManager` depends on. Returns the
/// engine's rich `PushOutcome` (applied / merged / conflicts / errors /
/// remaining) directly — no adapter shim.
@MainActor
protocol PushEngineProtocol: AnyObject {
    func push() async throws -> PushEngine.PushOutcome
}

/// The pull engine surface `SyncManager` depends on. Returns the engine's
/// rich `PullOutcome` (per-table upsert/delete maps + `fullResync` flag) so
/// `SyncManager` can react to a server-side cursor wipe by re-pulling.
@MainActor
protocol PullEngineProtocol: AnyObject {
    func pull() async throws -> PullEngine.PullOutcome
}

/// Signals whether the realtime SSE channel is currently delivering events.
/// `SyncManager` uses this to relax the foreground poll cadence — when SSE
/// is doing its job the poll is a safety net, not the realtime path, and
/// can fire less often. When SSE is down, the poll falls back to the fast
/// baseline so data lag stays bounded.
@MainActor
protocol SSEHealthSignal: AnyObject {
    /// True when the SSE stream is currently connected. SyncManager reads
    /// this on every poll cycle, so the implementation must be cheap.
    var isSSEHealthy: Bool { get }
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
///
/// Lifecycle: owned by `Session` (see `ActiveSession.swift`). A new instance
/// is created on sign-in; `stop()` is called deterministically on sign-out
/// before the underlying SwiftData store is wiped. Call sites reach the
/// active instance via `ActiveSession.syncManager` — when nil, callers
/// silently no-op (mutations still persist via the store and flush on the
/// next session's first push).
@MainActor
@Observable
final class SyncManager {
    // MARK: - Observable state

    private(set) var state: SyncState = .idle
    private(set) var lastSyncedAt: Date?

    // MARK: - Dependencies

    private let pushEngine: PushEngineProtocol
    private let pullEngine: PullEngineProtocol
    private let networkMonitor: NetworkMonitor
    private let modelContext: ModelContext?

    /// Optional SSE-health probe. When supplied AND signaling healthy AND
    /// no consecutive failures, the poll relaxes from `pollInterval` to
    /// `relaxedPollInterval` — SSE is already delivering invalidations so
    /// the poll is a safety net, not the realtime path. `nil` (or unhealthy)
    /// means we run the original fast poll cadence. Bound late so SSEClient
    /// → SyncManager doesn't become a hard dependency for tests.
    private weak var sseHealthSignal: SSEHealthSignal?

    /// Interval for the periodic foreground poll. Exposed so tests can use a
    /// much shorter value. Defaults to 30 seconds per the spec.
    private let pollInterval: TimeInterval

    /// Relaxed interval used when SSE is healthy and we've had no recent
    /// sync failures. Caps the worst-case data-lag at this duration if
    /// SSE silently drops between polls — `silentStreamWatchdog` (75s) +
    /// reconnect backoff means most drops self-detect well within the
    /// 2-minute window, so picking 120s here gives us a large radio-cost
    /// reduction (4×) without sacrificing freshness on a dead connection.
    private let relaxedPollInterval: TimeInterval

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

    /// Consecutive failures across the push+pull cycle. Used by the poll
    /// loop to back off exponentially (1s → 2s → 4s → 8s → … capped at
    /// 5 minutes). Debounced / user-initiated syncs are NOT throttled —
    /// they fire immediately because the user just expressed intent.
    /// Reset to 0 on any successful sync.
    /// Read-only outside the class so tests can pin the backoff side-effect
    /// of cancellations vs. real failures. Mutated only by `sync()`.
    private(set) var consecutiveFailures: Int = 0

    /// Upper bound on the backoff window. Five minutes — longer than the
    /// default 30s poll, but short enough that a user returning from a
    /// flaky network doesn't wait forever for fresh state.
    private static let maxBackoffSeconds: TimeInterval = 300

    // MARK: - Init

    init(
        pushEngine: PushEngineProtocol,
        pullEngine: PullEngineProtocol,
        networkMonitor: NetworkMonitor,
        modelContext: ModelContext?,
        sseHealthSignal: SSEHealthSignal? = nil,
        pollInterval: TimeInterval = 30,
        relaxedPollInterval: TimeInterval = 120,
        debounceInterval: TimeInterval = 1.0
    ) {
        self.pushEngine = pushEngine
        self.pullEngine = pullEngine
        self.networkMonitor = networkMonitor
        self.modelContext = modelContext
        self.sseHealthSignal = sseHealthSignal
        self.pollInterval = pollInterval
        self.relaxedPollInterval = relaxedPollInterval
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
        var anyPhaseSucceeded = false

        // Phase 1: push. Capture errors but still attempt the pull so a one-off
        // push hiccup doesn't block incoming server changes indefinitely.
        // Cancellations (URLError.cancelled / CancellationError) aren't real
        // failures — they just mean Task.cancel() reached an in-flight request
        // (debounce overlap, sign-out, app backgrounding) — so they bypass
        // both the error state and the backoff counter.
        state = .pushing
        do {
            _ = try await pushEngine.push()
            anyPhaseSucceeded = true
        } catch {
            if !Self.isCancellation(error) {
                firstError = describe(error)
            }
        }

        // Phase 2: pull. Always attempted so the server has the final say on
        // state even if our push stalled. When the server signals
        // `fullResync`, cursors were just wiped — run one more pull so the
        // current session reflects server state instead of frozen local data.
        state = .pulling
        do {
            let first = try await pullEngine.pull()
            if first.fullResync {
                _ = try await pullEngine.pull()
            }
            lastSyncedAt = Date()
            anyPhaseSucceeded = true
        } catch {
            if !Self.isCancellation(error) {
                // Preserve the push error if we had one — it's the more
                // actionable signal (a push failure means local mutations
                // haven't landed).
                firstError = firstError ?? describe(error)
            }
        }

        // Final state reflects whether either phase errored. The backoff
        // counter tracks consecutive failures so the poll loop can throttle
        // repeated retries on a flaky network. A cancellation-only cycle
        // (no real error, no successful phase) leaves the counter alone —
        // we didn't fail and we didn't succeed.
        if let message = firstError {
            state = .error(message)
            consecutiveFailures += 1
        } else {
            state = .idle
            if anyPhaseSucceeded {
                consecutiveFailures = 0
            }
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
            state = Self.isCancellation(error) ? .idle : .error(describe(error))
            throw error
        }

        state = .pulling
        do {
            let first = try await pullEngine.pull()
            if first.fullResync {
                _ = try await pullEngine.pull()
            }
            state = .idle
            lastSyncedAt = Date()
        } catch {
            state = Self.isCancellation(error) ? .idle : .error(describe(error))
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

    /// Periodic auto-poll while the app is in the foreground. Default
    /// cadence is `pollInterval` (30s); after a failed sync the loop backs
    /// off exponentially up to `maxBackoffSeconds` so we don't hammer a
    /// server that's already returning errors or a network that's flapping.
    /// `Task.sleep` pauses naturally when iOS suspends the app; `stop()`
    /// cancels cleanly.
    private func startForegroundPoll() {
        pollTask?.cancel()
        pollTask = Task { @MainActor [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                let waitSeconds = self.nextPollDelay()
                do {
                    try await Task.sleep(nanoseconds: UInt64(waitSeconds * 1_000_000_000))
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

    /// Compute the wait before the next poll.
    ///
    /// Two regimes:
    ///  - **Failure recovery** (`consecutiveFailures > 0`): always uses
    ///    the fast `pollInterval` baseline with exponential backoff.
    ///    A sync failure means our cursor management is out of step
    ///    with the server in a way SSE can't fix, so we want to retry
    ///    quickly regardless of SSE health.
    ///  - **Steady state** (`consecutiveFailures == 0`): uses
    ///    `relaxedPollInterval` when SSE is signaling healthy (the
    ///    realtime path is doing its job, poll is a safety net), or
    ///    `pollInterval` otherwise (poll IS the realtime path).
    ///    Both flavors get ±20% jitter to break thundering-herd patterns
    ///    when many clients return to foreground together.
    ///
    /// Failure-mode growth (unchanged): 30s → 60s → 120s → 240s → 300s (cap).
    /// Steady-state when SSE healthy: ~120s ± 20%.
    private func nextPollDelay() -> TimeInterval {
        Self.pollDelay(
            forFailures: consecutiveFailures,
            sseHealthy: sseHealthSignal?.isSSEHealthy == true,
            pollInterval: pollInterval,
            relaxedPollInterval: relaxedPollInterval,
            maxBackoff: Self.maxBackoffSeconds,
            jitter: Double.random(in: 0.8...1.2)
        )
    }

    /// Pure helper. Same shape as `backoffDelay(forFailures:...)` but
    /// folds in the SSE-aware steady-state branch so tests can pin the
    /// full decision matrix without standing up a SyncManager.
    /// `nonisolated` so tests can call off the main actor.
    nonisolated static func pollDelay(
        forFailures consecutiveFailures: Int,
        sseHealthy: Bool,
        pollInterval: TimeInterval,
        relaxedPollInterval: TimeInterval,
        maxBackoff: TimeInterval,
        jitter: Double
    ) -> TimeInterval {
        if consecutiveFailures > 0 {
            return backoffDelay(
                forFailures: consecutiveFailures,
                pollInterval: pollInterval,
                maxBackoff: maxBackoff,
                jitter: jitter
            )
        }
        let baseline = sseHealthy ? relaxedPollInterval : pollInterval
        return baseline * jitter
    }

    /// Pure, testable backoff math. `jitter` is injected so unit tests can
    /// assert deterministic values; production code passes a random 0.8...1.2
    /// multiplier. Exposed internally so `BackoffMathTests` can exercise
    /// every tier without a full `SyncManager` instance. `nonisolated` so
    /// tests can call it off the main actor (the function has no shared
    /// state — it's pure arithmetic).
    nonisolated static func backoffDelay(
        forFailures consecutiveFailures: Int,
        pollInterval: TimeInterval,
        maxBackoff: TimeInterval,
        jitter: Double
    ) -> TimeInterval {
        guard consecutiveFailures > 0 else { return pollInterval }
        // `pow(2, failures)` — using `failures` (not `failures - 1`) so
        // failure #1 doubles the interval instead of preserving it.
        let base = pollInterval * pow(2.0, Double(min(consecutiveFailures, 10)))
        let capped = min(base, maxBackoff)
        return capped * jitter
    }

    // MARK: - Cancellation classification

    /// True when an error originates from `Task.cancel()` propagating into a
    /// URLSession request (or surfacing as `CancellationError` directly).
    /// Kept `nonisolated static` so tests can exercise the matrix without a
    /// SyncManager instance, and so it's safe to call from any actor.
    ///
    /// Three shapes show up in practice:
    ///  - `URLError(.cancelled)` — `URLSession.data(for:)` after the parent
    ///    Task is cancelled.
    ///  - `CancellationError` — Swift concurrency primitives (e.g.
    ///    `Task.checkCancellation()`).
    ///  - `APIError.unknown(URLError(.cancelled))` — the same URLError after
    ///    `APIClient.map(urlError:)` wraps it for callers downstream.
    nonisolated static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled {
            return true
        }
        if let apiError = error as? APIError,
           case .unknown(let underlying) = apiError {
            if underlying is CancellationError { return true }
            if let urlError = underlying as? URLError, urlError.code == .cancelled {
                return true
            }
        }
        return false
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
        do {
            try context.save()
        } catch {
            BrettLog.sync.error("SyncManager resetInFlightMutations save failed: \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: - Helpers

    private func describe(_ error: Error) -> String {
        // APIError gets its diagnostic-quality message: includes the
        // URLError code for `.unknown` so the red-dot alert reveals the
        // actual transport failure ("Timed out", "Connection lost", etc.)
        // instead of bare "APIError.unknown" with no signal.
        if let apiError = error as? APIError {
            return apiError.diagnosticMessage
        }
        return (error as? LocalizedError)?.errorDescription ?? String(describing: error)
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

// Engine adapters moved to `ActiveSession.swift` where they're constructed
// per-session. Keeping them out of this file prevents the temptation to
// bring back a process-wide singleton — `SyncManager` must always be
// created with explicit engine instances bound to the current session.

