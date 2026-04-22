import Foundation
import SwiftData

/// Drains the `MutationQueue` to the server via `/sync/push`.
///
/// Responsibilities:
///  - Claim up to 50 pending mutations and mark them `in_flight`.
///  - POST the batch as a single `SyncPushRequest`.
///  - Apply each per-mutation result:
///      * `applied`   → upsert server record, complete mutation.
///      * `merged`    → upsert server record, log conflict, complete.
///      * `conflict`  → mark local `_syncStatus="conflict"`, log, fail.
///      * `not_found` → deletion already reconciled, complete.
///      * `error`     → record error, fail mutation.
///  - Update `SyncHealth` counters each pass.
///
/// Network errors do not bump retry counts — they reset the batch to
/// `pending` so the mutations are picked up again on the next push. This
/// mirrors the RN engine's behaviour.
@MainActor
final class PushEngine {
    // MARK: - Inputs

    private let mutationQueue: MutationQueueProtocol
    private let apiClient: APIClient
    private let context: ModelContext

    // MARK: - Summary

    /// Counts for a single push pass. Useful for telemetry and for the
    /// `pushAllReady()` drain loop so it knows when to stop.
    struct PushOutcome: Equatable {
        let applied: Int
        let merged: Int
        let conflicts: Int
        let errors: Int
        /// Mutations still in the queue after this pass.
        let remaining: Int

        static let empty = PushOutcome(applied: 0, merged: 0, conflicts: 0, errors: 0, remaining: 0)

        /// True when the push produced forward progress — consumed by
        /// `pushAllReady()` to decide whether to keep draining.
        var madeProgress: Bool {
            applied + merged + conflicts + errors > 0
        }
    }

    // MARK: - Init

    /// Production initialiser — borrows the shared persistence container.
    init(
        mutationQueue: MutationQueueProtocol,
        apiClient: APIClient = .shared,
        persistence: PersistenceController = .shared
    ) {
        self.mutationQueue = mutationQueue
        self.apiClient = apiClient
        self.context = persistence.mainContext
    }

    /// Test-oriented init — accepts any `ModelContext` so in-memory
    /// containers created by tests can be wired in directly.
    init(
        mutationQueue: MutationQueueProtocol,
        apiClient: APIClient,
        context: ModelContext
    ) {
        self.mutationQueue = mutationQueue
        self.apiClient = apiClient
        self.context = context
    }

    // MARK: - Push (single pass)

    /// Claim a batch of pending mutations and flush them to `/sync/push`.
    /// Safe to call concurrently only if `mutationQueue` serialises access;
    /// in practice the sync manager enforces a single in-flight call at a time.
    func push() async throws -> PushOutcome {
        let batch = mutationQueue.pendingEntries(limit: 50)

        if batch.isEmpty {
            // Keep health counters fresh even when nothing moves.
            updateSyncHealth(
                isPushing: false,
                pendingDelta: 0,
                success: true,
                error: nil
            )
            return .empty
        }

        mutationQueue.markInFlight(ids: batch.map(\.id))

        let payload = try buildPayload(for: batch)
        let response: SyncPushResponse

        do {
            markPushing(true)
            response = try await apiClient.syncPush(mutations: payload)
        } catch {
            // Transport failure — send the batch back to pending without
            // incrementing retry counters. Mirrors RN engine.
            for entry in batch {
                mutationQueue.fail(id: entry.id, error: "network: \(error)", errorCode: nil)
            }
            updateSyncHealth(
                isPushing: false,
                pendingDelta: 0,
                success: false,
                error: String(describing: error)
            )
            throw error
        }

        var applied = 0, merged = 0, conflicts = 0, errors = 0

        for result in response.results {
            guard let mutation = mutationQueue.getByIdempotencyKey(result.idempotencyKey) else {
                // Server returned a result for a mutation we don't recognise;
                // skip. This can happen in tests, or if the queue was wiped.
                continue
            }

            switch result.status {
            case .applied:
                applyServerRecord(result.record, to: mutation)
                mutationQueue.complete(id: mutation.id)
                applied += 1

            case .merged:
                applyServerRecord(result.record, to: mutation)
                logMergeConflict(result: result, mutation: mutation)
                mutationQueue.complete(id: mutation.id)
                merged += 1

            case .conflict:
                markLocalConflict(mutation: mutation)
                logMergeConflict(result: result, mutation: mutation)
                let message = result.error ?? "Server rejected mutation (conflict)."
                mutationQueue.fail(id: mutation.id, error: message, errorCode: 409)
                conflicts += 1

            case .notFound:
                // The record already matches the client's desired state
                // (a DELETE of a non-existent row, or a record the server
                // reaped). Drop the mutation.
                mutationQueue.complete(id: mutation.id)
                applied += 1

            case .error:
                let message = result.error ?? "Unknown server error."
                mutationQueue.fail(id: mutation.id, error: message, errorCode: nil)
                errors += 1
            }
        }

        // Persist all the changes we made to @Model records + the conflict log.
        try? context.save()

        let remaining = mutationQueue.pendingEntries(limit: 1).count
        let outcome = PushOutcome(
            applied: applied,
            merged: merged,
            conflicts: conflicts,
            errors: errors,
            remaining: remaining
        )

        updateSyncHealth(
            isPushing: false,
            pendingDelta: 0, // Recomputed absolutely inside updateSyncHealth.
            success: errors == 0 && conflicts == 0,
            error: nil
        )

        return outcome
    }

    // MARK: - Drain loop

    /// Keep pushing until the queue is empty or a pass fails without
    /// applying anything (e.g. all conflicts). Capped at 10 passes to avoid
    /// accidental tight loops if the server returns errors repeatedly.
    @discardableResult
    func pushAllReady(maxPasses: Int = 10) async throws -> PushOutcome {
        var totals = PushOutcome(applied: 0, merged: 0, conflicts: 0, errors: 0, remaining: 0)

        for _ in 0..<maxPasses {
            let outcome = try await push()
            totals = PushOutcome(
                applied: totals.applied + outcome.applied,
                merged: totals.merged + outcome.merged,
                conflicts: totals.conflicts + outcome.conflicts,
                errors: totals.errors + outcome.errors,
                remaining: outcome.remaining
            )
            if outcome.remaining == 0 { break }
            if !outcome.madeProgress { break }
        }

        return totals
    }

    // MARK: - Payload construction

    /// Convert a `MutationQueueEntry` batch into the dict shape the server
    /// expects. Payload is stored in the queue as a JSON string, so we parse
    /// it back into a dict here.
    private func buildPayload(for batch: [MutationQueueEntry]) throws -> [[String: Any]] {
        batch.map { entry in
            var dict: [String: Any] = [
                "idempotencyKey": entry.idempotencyKey,
                "entityType": entry.entityType,
                "entityId": entry.entityId,
                "action": entry.action,
                "payload": decodeJSONObject(entry.payload) ?? [:],
            ]
            if let changed = entry.changedFields,
               let arr = try? JSONSerialization.jsonObject(with: Data(changed.utf8)) as? [String] {
                dict["changedFields"] = arr
            }
            if let prev = entry.previousValues,
               let obj = try? JSONSerialization.jsonObject(with: Data(prev.utf8)) as? [String: Any] {
                dict["previousValues"] = obj
            }
            if let base = entry.baseUpdatedAt {
                dict["baseUpdatedAt"] = base
            }
            return dict
        }
    }

    private func decodeJSONObject(_ string: String) -> [String: Any]? {
        guard let data = string.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    // MARK: - Record application / conflict bookkeeping

    /// Write the server's authoritative record back into SwiftData, bypassing
    /// the pending-write guard (we know the push succeeded, so local state
    /// should catch up to the server).
    private func applyServerRecord(_ record: [String: Any]?, to mutation: MutationQueueEntry) {
        guard let record else { return }
        let table = tableName(for: mutation.entityType)
        SyncEntityMapper.upsert(
            tableName: table,
            record: record,
            context: context,
            respectLocalPending: false
        )
    }

    /// Set `_syncStatus = "conflict"` on the local record corresponding to
    /// a rejected mutation. If we can't find the record the mutation refers
    /// to, we skip — the record may have been deleted out from under us.
    private func markLocalConflict(mutation: MutationQueueEntry) {
        switch mutation.entityType {
        case "item":
            if let m = fetchItem(id: mutation.entityId) {
                m._syncStatus = SyncStatus.conflict.rawValue
            }
        case "list":
            if let m = fetchList(id: mutation.entityId) {
                m._syncStatus = SyncStatus.conflict.rawValue
            }
        case "calendar_event_note":
            if let m = fetchEventNote(id: mutation.entityId) {
                m._syncStatus = SyncStatus.conflict.rawValue
            }
        default:
            // Attempting to push other entity types → server rejects first,
            // so we rarely reach here. Log nothing.
            break
        }
    }

    /// Pushable types are known at compile time (Item / ItemList /
    /// CalendarEventNote — see server allowlist). Each helper uses a typed
    /// predicate so SwiftData can resolve it properly under Swift 6 generics.
    private func fetchItem(id: String) -> Item? {
        let pred = #Predicate<Item> { $0.id == id }
        var d = FetchDescriptor<Item>(predicate: pred)
        d.fetchLimit = 1
        return try? context.fetch(d).first
    }

    private func fetchList(id: String) -> ItemList? {
        let pred = #Predicate<ItemList> { $0.id == id }
        var d = FetchDescriptor<ItemList>(predicate: pred)
        d.fetchLimit = 1
        return try? context.fetch(d).first
    }

    private func fetchEventNote(id: String) -> CalendarEventNote? {
        let pred = #Predicate<CalendarEventNote> { $0.id == id }
        var d = FetchDescriptor<CalendarEventNote>(predicate: pred)
        d.fetchLimit = 1
        return try? context.fetch(d).first
    }

    /// Write a ConflictLogEntry for `merged` / `conflict` results.
    private func logMergeConflict(result: SyncPushResult, mutation: MutationQueueEntry) {
        let localValues = decodeJSONObject(mutation.payload) ?? [:]
        let serverValues = result.record ?? [:]
        let resolution: String = result.status == .conflict ? "server_wins" : "merged"

        ConflictResolver.logConflict(
            entityType: mutation.entityType,
            entityId: mutation.entityId,
            mutationId: mutation.id,
            localValues: localValues,
            serverValues: serverValues,
            conflictedFields: result.conflictedFields,
            resolution: resolution,
            context: context
        )
    }

    /// Convert a singular entity type (`"item"`) to its pluralised sync-table
    /// name (`"items"`). Kept local so the push engine doesn't reach into
    /// SyncEntityMapper internals.
    private func tableName(for entityType: String) -> String {
        switch entityType {
        case "item": return "items"
        case "list": return "lists"
        case "calendar_event": return "calendar_events"
        case "calendar_event_note": return "calendar_event_notes"
        case "scout": return "scouts"
        case "scout_finding": return "scout_findings"
        case "brett_message": return "brett_messages"
        case "attachment": return "attachments"
        default: return entityType
        }
    }

    // MARK: - SyncHealth

    private func markPushing(_ value: Bool) {
        let health = fetchHealth()
        health.isPushing = value
    }

    /// Rewrite the singleton SyncHealth row with fresh counters.
    private func updateSyncHealth(
        isPushing: Bool,
        pendingDelta: Int,
        success: Bool,
        error: String?
    ) {
        let health = fetchHealth()
        health.isPushing = isPushing
        // We compute absolute counts rather than deltas — accurate across
        // app restarts and safe even if the delta drifts.
        health.pendingMutationCount = mutationQueue.pendingEntries(limit: 10_000).count
        health.deadMutationCount = deadCount()
        if success {
            health.lastSuccessfulPushAt = Date()
            health.consecutiveFailures = 0
            health.lastError = nil
        } else {
            health.consecutiveFailures += 1
            health.lastError = error
        }
        try? context.save()
    }

    /// Count mutations whose status is `dead`. Queried directly rather than
    /// depending on a new `MutationQueueProtocol` method so we stay decoupled
    /// from W2-A's implementation.
    private func deadCount() -> Int {
        // Predicated fetchCount so SwiftData counts on its side instead of
        // loading every queue entry into memory.
        let deadRaw = MutationStatus.dead.rawValue
        let descriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.status == deadRaw }
        )
        return (try? context.fetchCount(descriptor)) ?? 0
    }

    /// Singleton SyncHealth row. Created lazily on first access.
    private func fetchHealth() -> SyncHealth {
        let descriptor = FetchDescriptor<SyncHealth>()
        if let existing = (try? context.fetch(descriptor))?.first {
            return existing
        }
        let created = SyncHealth()
        context.insert(created)
        return created
    }
}
