import Foundation
import Observation

/// Abstraction for the sync engine's debounced push-pull trigger.
///
/// The handler needs a way to say "something changed on the server, reconcile
/// local state". The real `SyncManager` exposes `schedulePushDebounced()`,
/// which coalesces rapid calls into a single push+pull cycle — exactly what
/// we want. We depend on a protocol instead of the concrete type so tests
/// can inject a spy without standing up the whole sync stack.
@MainActor
protocol SSESyncTrigger: AnyObject {
    /// Schedule a sync cycle. Multiple calls within a short window should
    /// coalesce into one — SyncManager debounces ~1s.
    func schedulePushDebounced()
}

// MARK: - SyncManager conformance

// Added here so we don't touch SyncManager.swift (owned by W2-C). Safe because
// the protocol method matches the existing SyncManager signature verbatim.
extension SyncManager: SSESyncTrigger {}

/// Routes raw `SSEEvent`s into the appropriate local-state invalidations.
///
/// For most entity-change events (item / list / calendar / attachment etc.)
/// the handler just asks the sync engine to pull — pulls are incremental and
/// reconcile the full state, which is simpler and less error-prone than
/// trying to apply a partial SSE payload into SwiftData directly.
///
/// For events that surface into live UI (scout findings, Brett chat
/// messages), the handler could additionally poke a store; for now we just
/// call the relevant store's `refresh` method if the store exposes one.
/// We keep those hooks behind `Optional` so tests + early integration don't
/// need every store plumbed through.
///
/// Lifecycle: call `start()` once when authenticated. Internally iterates
/// `sseClient.events` until the app shuts down or the handler is torn down.
@MainActor
@Observable
final class SSEEventHandler {
    // MARK: - Dependencies

    private let sseClient: SSEClient
    private weak var syncTrigger: SSESyncTrigger?

    // MARK: - State

    private var consumerTask: Task<Void, Never>?

    /// Last event observed. Mostly for diagnostics / tests.
    private(set) var lastEvent: SSEEvent?

    // MARK: - Init

    init(sseClient: SSEClient, syncTrigger: SSESyncTrigger? = nil) {
        self.sseClient = sseClient
        self.syncTrigger = syncTrigger
    }

    // MARK: - Lifecycle

    /// Start consuming events. Idempotent — calling twice is a no-op.
    func start() {
        guard consumerTask == nil else { return }
        consumerTask = Task { [weak self] in
            guard let self else { return }
            for await event in self.sseClient.events {
                await self.handle(event)
            }
        }
    }

    /// Stop consuming. `sseClient.events` stays open for other subscribers.
    func stop() {
        consumerTask?.cancel()
        consumerTask = nil
    }

    // MARK: - Dispatch

    /// Route a single event. `internal` for tests.
    func handle(_ event: SSEEvent) async {
        lastEvent = event

        guard let type = SSEEventType(rawValue: event.type) else {
            // Unknown type — log-worthy once we have logging, but dropping
            // it is safer than crashing on a server-side addition.
            return
        }

        switch type {
        case .connected:
            // Server hello — nothing to do, but triggering a pull here gets
            // us to "fresh" quickly in case we missed events while offline.
            syncTrigger?.schedulePushDebounced()

        case .itemCreated,
             .itemUpdated,
             .itemDeleted,
             .listCreated,
             .listUpdated,
             .listDeleted,
             .calendarEventCreated,
             .calendarEventUpdated,
             .calendarEventDeleted,
             .calendarEventNoteUpdated,
             .attachmentCreated,
             .attachmentDeleted:
            syncTrigger?.schedulePushDebounced()

        case .scoutStatusChanged,
             .scoutFindingCreated,
             .scoutRunCompleted:
            // Scouts land through the regular pull plus may have their own
            // dedicated refresh path. Triggering a pull is always safe.
            syncTrigger?.schedulePushDebounced()

        case .brettMessageCreated:
            // Chat messages are surfaced to any open chat window via the
            // same MessageStore the pull engine writes to, so a pull suffices.
            syncTrigger?.schedulePushDebounced()

        case .contentExtracted:
            // A specific item finished content extraction — the item was
            // updated server-side, so pull will pick up the new preview.
            syncTrigger?.schedulePushDebounced()
        }
    }
}
