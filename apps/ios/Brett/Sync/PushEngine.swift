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
    /// Background ModelActor for the per-row apply of server-confirmed
    /// records. The mutation queue (status transitions, idempotency,
    /// compaction) stays on main because `MutationCompactor` reasons
    /// about the entire pending queue transactionally; only the domain
    /// row apply moves off main. Optional only for the in-memory test
    /// path.
    private let syncData: SyncDataActor?

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
        persistence: PersistenceController = .shared,
        syncData: SyncDataActor? = nil
    ) {
        self.mutationQueue = mutationQueue
        self.apiClient = apiClient
        self.context = persistence.mainContext
        self.syncData = syncData ?? SyncDataActor(modelContainer: persistence.container)
    }

    /// Test-oriented init — accepts any `ModelContext` so in-memory
    /// containers created by tests can be wired in directly. Tests apply
    /// server records through the test context (no background actor) so
    /// existing test fixtures don't need to care about cross-actor scheduling.
    init(
        mutationQueue: MutationQueueProtocol,
        apiClient: APIClient,
        context: ModelContext
    ) {
        self.mutationQueue = mutationQueue
        self.apiClient = apiClient
        self.context = context
        self.syncData = nil
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

        // First pass — classify every result. Collect:
        //   * records to apply on the background actor
        //   * queue transitions to commit on main AFTER the apply lands
        //   * conflict logs to write
        // No queue mutations happen here yet; we want the domain row
        // update to become observable BEFORE the queue says "applied,"
        // otherwise a UI re-fetch in between could see stale data while
        // the queue claims the mutation succeeded. Doing the classify
        // pass first also lets us skip any queue work if the bg apply
        // throws — the next push retries via the server's idempotency
        // key and we never claim success against a row we couldn't
        // commit.
        var serverRecordsToApply: [SyncDataActor.ServerRecord] = []
        // Snapshot the matched mutation so we don't have to re-query
        // by idempotency key after the await (the queue may have
        // shifted in the meantime if a debounced push landed).
        struct PendingDecision {
            enum Action { case complete, conflict(message: String), error(message: String) }
            let mutationId: String
            let action: Action
            let conflictResult: SyncPushResult?
            let mutation: MutationQueueEntry
        }
        var decisions: [PendingDecision] = []

        for result in response.results {
            guard let mutation = mutationQueue.getByIdempotencyKey(result.idempotencyKey) else {
                continue
            }
            switch result.status {
            case .applied:
                if let record = result.record {
                    serverRecordsToApply.append(SyncDataActor.ServerRecord(
                        table: tableName(for: mutation.entityType),
                        record: record
                    ))
                }
                decisions.append(PendingDecision(
                    mutationId: mutation.id,
                    action: .complete,
                    conflictResult: nil,
                    mutation: mutation
                ))
                applied += 1

            case .merged:
                if let record = result.record {
                    serverRecordsToApply.append(SyncDataActor.ServerRecord(
                        table: tableName(for: mutation.entityType),
                        record: record
                    ))
                }
                decisions.append(PendingDecision(
                    mutationId: mutation.id,
                    action: .complete,
                    conflictResult: result,
                    mutation: mutation
                ))
                merged += 1

            case .conflict:
                let message = result.error ?? "Server rejected mutation (conflict)."
                decisions.append(PendingDecision(
                    mutationId: mutation.id,
                    action: .conflict(message: message),
                    conflictResult: result,
                    mutation: mutation
                ))
                conflicts += 1

            case .notFound:
                decisions.append(PendingDecision(
                    mutationId: mutation.id,
                    action: .complete,
                    conflictResult: nil,
                    mutation: mutation
                ))
                applied += 1

            case .error:
                let message = result.error ?? "Unknown server error."
                decisions.append(PendingDecision(
                    mutationId: mutation.id,
                    action: .error(message: message),
                    conflictResult: nil,
                    mutation: mutation
                ))
                errors += 1
            }
        }

        // Apply the server-confirmed records FIRST on the background
        // actor so the domain row update is committed (and observable to
        // every @Query subscriber via SwiftData history) before we mark
        // any mutation "applied." If this throws, we skip the
        // corresponding queue transitions — the next push retries via
        // the server's idempotency key, which is exactly what
        // server-side dedupe is for. Better to redo the network round
        // trip than to claim local-side success against a row that
        // didn't materialise.
        var bgApplyFailed = false
        if !serverRecordsToApply.isEmpty {
            do {
                if let syncData {
                    try await syncData.applyServerRecords(serverRecordsToApply)
                } else {
                    for r in serverRecordsToApply {
                        SyncEntityMapper.upsert(
                            tableName: r.table,
                            record: r.record,
                            context: context,
                            respectLocalPending: false
                        )
                    }
                }
            } catch {
                BrettLog.push.error("push server-record apply failed: \(String(describing: error), privacy: .public)")
                bgApplyFailed = true
            }
        }

        // Second pass — commit queue transitions + conflict logs on
        // main. If the bg apply failed we skip the .complete actions
        // for results that needed a row write so the queue stays
        // pending and the next push retries. Conflicts and errors are
        // safe to commit either way (they don't depend on a row write).
        for decision in decisions {
            switch decision.action {
            case .complete:
                if bgApplyFailed && decision.conflictResult?.record != nil {
                    // This .applied/.merged depended on a row apply
                    // that didn't land — leave the mutation pending.
                    continue
                }
                if let result = decision.conflictResult {
                    logMergeConflict(result: result, mutation: decision.mutation)
                }
                mutationQueue.complete(id: decision.mutationId)
            case .conflict(let message):
                markLocalConflict(mutation: decision.mutation)
                if let result = decision.conflictResult {
                    logMergeConflict(result: result, mutation: decision.mutation)
                }
                mutationQueue.fail(id: decision.mutationId, error: message, errorCode: 409)
            case .error(let message):
                mutationQueue.fail(id: decision.mutationId, error: message, errorCode: nil)
            }
        }

        // Save main context: mutation queue transitions + conflict logs
        // (and, in the test path, the in-line server records too).
        do {
            try context.save()
        } catch {
            BrettLog.push.error("push save failed: \(String(describing: error), privacy: .public)")
        }

        let remaining = mutationQueue.pendingCount()
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
        health.pendingMutationCount = mutationQueue.pendingCount()
        health.deadMutationCount = deadCount()
        if success {
            health.lastSuccessfulPushAt = Date()
            health.consecutiveFailures = 0
            health.lastError = nil
        } else {
            health.consecutiveFailures += 1
            health.lastError = error
        }
        do {
            try context.save()
        } catch {
            BrettLog.push.error("updateSyncHealth save failed: \(String(describing: error), privacy: .public)")
        }
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
