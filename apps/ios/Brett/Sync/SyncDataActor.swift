import Foundation
import SwiftData

/// Background ModelActor for the dominant cost of /sync/pull and the apply
/// step of /sync/push: per-row upsert/delete + the matching `save()`.
///
/// Owns its own `ModelContext` bound to the same `ModelContainer` the UI's
/// main context uses, so saves here propagate to every `@Query` observer
/// via SwiftData's history tracking — no manual main-actor hop required
/// for the UI to refresh.
///
/// Why this exists: PullEngine used to be `@MainActor` and applied each
/// upsert/delete on the main thread. Even with `Task.yield()` between
/// rows the cumulative cost (fetch-by-id + apply fields + insert/update
/// + save) blocked the main run loop for tens of milliseconds per round.
/// Power users with thousands of items felt the lag as a frozen UI for
/// the duration of a sync climb. Moving the per-row work to a background
/// actor leaves the UI thread free for scroll, taps, and rendering.
///
/// Scope: per-row apply + the matching save() are the only things this
/// actor owns. Cursors, SyncHealth, MutationQueue state, and full-resync
/// wipes stay on the main context — they're tiny, infrequent, and
/// straightforward enough that splitting them adds complexity without
/// measurable gain. (And MutationQueue must stay on main because
/// `MutationCompactor` reasons about the entire pending queue
/// transactionally.)
///
/// Concurrency:
///   - The actor's serial executor guarantees in-order processing across
///     concurrent callers.
///   - `modelContext` is non-Sendable but lives on the actor's executor
///     — safe as long as no other actor reaches in.
///   - Payload types use `@unchecked Sendable` because they wrap
///     `[String: Any]` dicts produced by `JSONSerialization`. Those
///     dicts contain only value-type / immutable Foundation reference
///     types (NSString, NSNumber, NSDictionary), so passing them across
///     actor boundaries is safe in practice; the Sendable check
///     can't reason about that automatically.
@ModelActor
actor SyncDataActor {

    // MARK: - Payload wrappers

    /// One table's slice from a /sync/pull round. Wrapped in a struct so
    /// the actor takes a single argument (one cross-actor hop per round)
    /// rather than per-table.
    struct PullSlice: @unchecked Sendable {
        let table: String
        let upserts: [[String: Any]]
        let deletes: [String]
    }

    /// One row returned from /sync/push (`applied` or `merged` results).
    /// Bypasses the local-pending guard because the push succeeded — local
    /// state must catch up to server.
    struct ServerRecord: @unchecked Sendable {
        let table: String
        let record: [String: Any]
    }

    // MARK: - Pull side

    /// Apply a full round's table slices in a single transaction, then
    /// save once. Returns per-table row counts actually persisted (matching
    /// the existing `PullOutcome` telemetry shape).
    ///
    /// Local pending writes are skipped — `respectLocalPending: true`
    /// inside `SyncEntityMapper.upsert` checks `_syncStatus` before
    /// clobbering. Counts here include skipped-pending rows because
    /// the existing PullOutcome semantics counted them.
    ///
    /// One save covers every table in the round so a mid-round crash
    /// can't leave inconsistent partial state — same atomicity the
    /// `@MainActor`-era PullEngine offered.
    func applyPullRound(
        _ slices: [PullSlice]
    ) throws -> [String: (upserted: Int, deleted: Int)] {
        var counts: [String: (upserted: Int, deleted: Int)] = [:]

        for slice in slices {
            var inserted = 0
            for record in slice.upserts {
                SyncEntityMapper.upsert(
                    tableName: slice.table,
                    record: record,
                    context: modelContext,
                    respectLocalPending: true
                )
                inserted += 1
            }

            var deletedCount = 0
            for id in slice.deletes {
                SyncEntityMapper.hardDelete(
                    tableName: slice.table,
                    id: id,
                    context: modelContext
                )
                deletedCount += 1
            }

            counts[slice.table] = (inserted, deletedCount)
        }

        try modelContext.save()
        return counts
    }

    // MARK: - Push side

    /// Apply a batch of server-confirmed mutation records (the response
    /// payload of /sync/push). Bypasses the local-pending guard because
    /// the push succeeded by definition — local state must catch up to
    /// what the server now holds.
    ///
    /// Single save() at the end so a multi-record batch lands as one
    /// transaction (mirroring the prior PushEngine behaviour).
    func applyServerRecords(_ records: [ServerRecord]) throws {
        for r in records {
            SyncEntityMapper.upsert(
                tableName: r.table,
                record: r.record,
                context: modelContext,
                respectLocalPending: false
            )
        }
        try modelContext.save()
    }
}
