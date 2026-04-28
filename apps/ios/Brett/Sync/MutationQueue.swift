import Foundation
import SwiftData

/// Durable FIFO queue of pending writes, backed by `MutationQueueEntry` rows
/// in SwiftData. Mirrors `apps/mobile/src/sync/mutation-queue.ts`.
///
/// - Stores stage new entries via `MutationCompactor.compactAndApply(_:in:)`
///   alongside their optimistic SwiftData write, then commit both in a single
///   `context.save()`. Compaction collapses redundant mutations before they
///   ever reach the push engine.
/// - The push engine (W2-B) drains pending entries via `pendingEntries(limit:)`,
///   flips them to in-flight via `markInFlight(ids:)`, then calls
///   `complete(id:)` or `fail(id:...)` depending on server response.
/// - On app launch the sync manager (W2-C) calls `resetInFlight()` so any
///   rows that were mid-flight during a crash get another shot.
///
/// `MutationQueue` is `@MainActor` because `ModelContext` requires the main
/// actor. The compactor (`MutationCompactor`) is a value type that can run
/// anywhere — it's intentionally split out for testability.
@MainActor
final class MutationQueue: MutationQueueProtocol {
    /// Max retries before a non-network failure is considered permanent.
    /// Matches spec §2.4 ("retryCount >= 10 → dead").
    static let maxRetries = 10

    /// Visible at module level (not `private`) so test-only helpers can stage
    /// a `MutationCompactor.compactAndApply(_:in:)` + save against the same
    /// context for queue-lifecycle setup. Production callers go through the
    /// store's own context — they don't read this.
    let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    // MARK: - Query

    /// Return pending entries in FIFO order (createdAt ASC) that are eligible
    /// to be pushed right now. Entries whose `dependsOn` predecessor is still
    /// pending are skipped — the push engine will re-query after the parent
    /// completes.
    ///
    /// Status filter: `.pending` only. `.inFlight`, `.failed`, `.dead`, and
    /// `.blocked` are excluded here. `dead`/`blocked` have dedicated helpers
    /// below for UI surfaces.
    func pendingEntries(limit: Int = 50) -> [MutationQueueEntry] {
        let all = allPending()
        let allIDs = Set(all.map(\.id))

        var result: [MutationQueueEntry] = []
        result.reserveCapacity(min(limit, all.count))
        var included = Set<String>()

        for entry in all where result.count < limit {
            if let parent = entry.dependsOn, allIDs.contains(parent), !included.contains(parent) {
                // Predecessor is still pending and not yet in our batch — defer.
                continue
            }
            result.append(entry)
            included.insert(entry.id)
        }

        return result
    }

    /// All rows with status="dead". Used by the DLQ UI (spec §2.7).
    func deadEntries() -> [MutationQueueEntry] {
        let deadRaw = MutationStatus.dead.rawValue
        var descriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.status == deadRaw },
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )
        descriptor.includePendingChanges = true
        return (try? context.fetch(descriptor)) ?? []
    }

    /// All rows with status="blocked" — i.e. whose dependency permanently
    /// failed. Surfaced alongside dead entries in the sync health UI.
    func blockedEntries() -> [MutationQueueEntry] {
        let blockedRaw = MutationStatus.blocked.rawValue
        var descriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.status == blockedRaw },
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )
        descriptor.includePendingChanges = true
        return (try? context.fetch(descriptor)) ?? []
    }

    /// Count of rows in `.pending` status — uses `fetchCount` so the
    /// caller never has to materialise the full queue for a count.
    /// Matters because SyncHealth telemetry on every push pass used
    /// to call `pendingEntries(limit: 10_000)` and allocate up to
    /// 10k SwiftData objects on main just to read `.count`.
    func pendingCount() -> Int {
        let pendingRaw = MutationStatus.pending.rawValue
        let descriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.status == pendingRaw }
        )
        return (try? context.fetchCount(descriptor)) ?? 0
    }

    /// Look up an entry by its idempotency key — used by HTTP retry paths
    /// to detect duplicates before resubmitting.
    func getByIdempotencyKey(_ key: String) -> MutationQueueEntry? {
        var descriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.idempotencyKey == key }
        )
        descriptor.fetchLimit = 1
        descriptor.includePendingChanges = true
        return try? context.fetch(descriptor).first
    }

    // MARK: - Status transitions

    /// Bulk-update the given entries from pending → in_flight. Called by the
    /// push engine after claiming a batch but before sending the HTTP call.
    func markInFlight(ids: [String]) {
        guard !ids.isEmpty else { return }
        let ids = Set(ids)
        for entry in allPendingIncludingInFlight() where ids.contains(entry.id) {
            entry.status = MutationStatus.inFlight.rawValue
        }
        save()
    }

    /// Successful push — the entry is no longer needed.
    func complete(id: String) {
        guard let entry = entry(withId: id) else { return }
        context.delete(entry)
        save()
    }

    /// Failure handler. Increments retryCount, records the error, and flips
    /// the entry to "dead" if the failure is permanent.
    ///
    /// - Permanent 4xx (400/403/404/409/422) → immediately dead.
    /// - 5xx / other server errors → dead once retryCount ≥ maxRetries.
    /// - Network errors (errorCode == nil or 0) → stay pending, retryCount
    ///   is not incremented (they retry indefinitely per spec §2.4).
    func fail(id: String, error: String, errorCode: Int?) {
        guard let entry = entry(withId: id) else { return }
        entry.error = error
        entry.errorCode = errorCode

        let isNetworkError = (errorCode == nil) || (errorCode == 0)
        if isNetworkError {
            // Reset to pending so the push engine will pick it up again.
            entry.status = MutationStatus.pending.rawValue
            save()
            return
        }

        if Self.isPermanent4xx(errorCode) {
            entry.status = MutationStatus.dead.rawValue
            save()
            return
        }

        entry.retryCount += 1
        if entry.retryCount >= Self.maxRetries {
            entry.status = MutationStatus.dead.rawValue
        } else {
            // Back to pending so it gets another attempt after backoff.
            entry.status = MutationStatus.pending.rawValue
        }
        save()
    }

    /// Called on init / app launch to recover from a crash: anything that
    /// was in_flight when the process died should be retried.
    func resetInFlight() {
        let inFlightRaw = MutationStatus.inFlight.rawValue
        var descriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.status == inFlightRaw }
        )
        descriptor.includePendingChanges = true
        let stuck = (try? context.fetch(descriptor)) ?? []
        guard !stuck.isEmpty else { return }
        for entry in stuck {
            entry.status = MutationStatus.pending.rawValue
        }
        save()
    }

    // MARK: - Internals

    private func save() {
        do {
            try context.save()
        } catch {
            // Queue-state save failures are high-severity: they mean a
            // mutation transition (pending→in_flight, retry bump, dead,
            // etc.) didn't hit disk. The next launch reads the pre-save
            // state, which is usually recoverable but can surprise the
            // user. Log at error level so sysdiagnose picks it up.
            BrettLog.sync.error("MutationQueue save failed: \(String(describing: error), privacy: .public)")
        }
    }

    private func entry(withId id: String) -> MutationQueueEntry? {
        var descriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.id == id }
        )
        descriptor.fetchLimit = 1
        descriptor.includePendingChanges = true
        return try? context.fetch(descriptor).first
    }

    private func allPending() -> [MutationQueueEntry] {
        let pendingRaw = MutationStatus.pending.rawValue
        var descriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.status == pendingRaw },
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )
        descriptor.includePendingChanges = true
        return (try? context.fetch(descriptor)) ?? []
    }

    /// Returns all pending + in-flight rows for bulk status updates. The
    /// SwiftData predicate syntax is limited, so we filter in Swift.
    private func allPendingIncludingInFlight() -> [MutationQueueEntry] {
        let pendingRaw = MutationStatus.pending.rawValue
        let inFlightRaw = MutationStatus.inFlight.rawValue
        var descriptor = FetchDescriptor<MutationQueueEntry>(
            predicate: #Predicate { $0.status == pendingRaw || $0.status == inFlightRaw }
        )
        descriptor.includePendingChanges = true
        return (try? context.fetch(descriptor)) ?? []
    }

    /// HTTP status codes that are never worth retrying: the server will
    /// reject the payload deterministically no matter how many times we
    /// resend it. Spec §2.4 + §RESILIENCE lists 400/422 as permanent.
    /// Other 4xx codes are EITHER transient or permanent — we treat the
    /// transient ones (`408`, `429`) and `5xx` the same as a network
    /// error (retry on the next push cycle), and only the truly
    /// permanent client errors (everything else in the 4xx band) as
    /// dead-on-arrival.
    ///
    /// 429 in particular: a transient rate-limit blip used to be marked
    /// dead, which silently dropped the user's mutation forever. The
    /// next push cycle will retry instead.
    private static func isPermanent4xx(_ code: Int?) -> Bool {
        guard let code else { return false }
        // Out of the 4xx band → not 4xx-permanent.
        if !(400...499).contains(code) { return false }
        // Transient throttling / timeout — retry, don't kill.
        if code == 408 || code == 429 { return false }
        return true
    }
}
