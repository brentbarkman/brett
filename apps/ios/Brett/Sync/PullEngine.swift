import Foundation
import SwiftData

/// Fetches server-side changes via `/sync/pull` and reconciles them with
/// local SwiftData state.
///
/// Rules:
///  - Read per-table cursors from `SyncCursor`. Missing → `null`.
///  - POST `/sync/pull`. On `fullSyncRequired=true`, wipe local records for
///    affected tables and reset cursors, then bail — caller decides whether
///    to retry.
///  - Upsert per table, skipping any local record whose `_syncStatus` is not
///    `synced` (we don't clobber pending local writes).
///  - Hard-delete on tombstones regardless of local state (pulls are
///    authoritative for deletions).
///  - Advance each table's cursor to the value the server sent back.
///  - Save rows AND cursors in a single `context.save()` per round so a
///    crash mid-round rolls back atomically (cursor never advances without
///    the rows that justify it, and vice versa).
///  - Loop up to `maxRounds` times if any table reports `hasMore=true`.
///  - Update `SyncHealth.lastSuccessfulPullAt` on success.
///
/// `PullError` propagates out when a round's save fails — the caller's
/// backoff kicks in and the next pull starts from the same cursor, which
/// is safe because upserts are idempotent.
@MainActor
final class PullEngine {
    // MARK: - Inputs

    private let apiClient: APIClient
    private let context: ModelContext

    // MARK: - Summary

    struct PullOutcome: Equatable {
        /// Upserts *actually persisted* (post-save success) per table. Skipped
        /// records (local pending writes) are excluded.
        let tablesUpserted: [String: Int]
        /// Hard deletions persisted per table.
        let tablesDeleted: [String: Int]
        /// `true` when the server asked the client to wipe cursors and
        /// re-pull from scratch. The caller should decide whether to retry.
        let fullResync: Bool

        static let empty = PullOutcome(tablesUpserted: [:], tablesDeleted: [:], fullResync: false)
    }

    enum PullError: LocalizedError {
        case savePersistFailed(underlying: Error)

        var errorDescription: String? {
            switch self {
            case .savePersistFailed(let underlying):
                return "Pull save failed: \(underlying.localizedDescription)"
            }
        }
    }

    // MARK: - Init

    /// Production initialiser — borrows the shared persistence container.
    init(
        apiClient: APIClient = .shared,
        persistence: PersistenceController = .shared
    ) {
        self.apiClient = apiClient
        self.context = persistence.mainContext
    }

    /// Test-oriented init — accepts any `ModelContext` for in-memory
    /// containers in test suites.
    init(
        apiClient: APIClient,
        context: ModelContext
    ) {
        self.apiClient = apiClient
        self.context = context
    }

    // MARK: - Pull

    /// Run a single pull cycle. Loops internally (up to `maxRounds`) when
    /// the server reports `hasMore` — one round per `limit` slice.
    func pull(maxRounds: Int = 10) async throws -> PullOutcome {
        var tablesUpserted: [String: Int] = [:]
        var tablesDeleted: [String: Int] = [:]

        markPulling(true)
        defer { markPulling(false) }

        // Cache the cursor rows once — the original implementation refetched
        // the whole `SyncCursor` table on every read (currentCursors,
        // upsertCursor) yielding O(tables × rounds) fetches per pull.
        var cursorCache = loadCursorCache()

        for _ in 0..<maxRounds {
            let cursors = cursorMap(from: cursorCache)
            let response: SyncPullResponse

            do {
                response = try await apiClient.syncPull(cursors: cursors)
            } catch {
                recordPullFailure(error: error)
                throw error
            }

            if response.fullSyncRequired {
                // Server invalidated the client's cursors — typically after a
                // schema migration or a server-side data reset. Clear the
                // local mirror for the affected tables AND wipe cursors so
                // the next pull re-fetches authoritative state. Without the
                // row wipe, deleted-server-side rows linger locally and can
                // render ghost entries until a subsequent pull catches them.
                wipeLocalRecordsForFullResync()
                resetAllCursors()
                cursorCache = [:]
                recordPullFailure(error: nil)
                return PullOutcome(
                    tablesUpserted: tablesUpserted,
                    tablesDeleted: tablesDeleted,
                    fullResync: true
                )
            }

            var anyHasMore = false
            var pendingUpsertsThisRound: [String: Int] = [:]
            var pendingDeletesThisRound: [String: Int] = [:]

            // Yield every `yieldBatch` rows so a big pull doesn't lock up
            // the main actor. SyncEntityMapper.upsert is @MainActor, and on
            // a 500-item page each row takes ~200-500µs — which sums to
            // ~100-250ms of contiguous main-thread work without yields.
            // `Task.yield()` lets UI gestures, @Query refreshes, and other
            // main-actor tasks interleave. `isSyncing` in SyncManager
            // prevents another pull from racing in.
            let yieldBatch = 100
            var sinceYield = 0

            for table in SyncProtocol.tables {
                guard let slice = response.changes[table] else { continue }

                var inserted = 0
                for record in slice.upserted {
                    SyncEntityMapper.upsert(
                        tableName: table,
                        record: record,
                        context: context,
                        respectLocalPending: true
                    )
                    inserted += 1
                    sinceYield += 1
                    if sinceYield >= yieldBatch {
                        sinceYield = 0
                        await Task.yield()
                    }
                }

                var deleted = 0
                for id in slice.deleted {
                    SyncEntityMapper.hardDelete(
                        tableName: table,
                        id: id,
                        context: context
                    )
                    deleted += 1
                    sinceYield += 1
                    if sinceYield >= yieldBatch {
                        sinceYield = 0
                        await Task.yield()
                    }
                }

                pendingUpsertsThisRound[table] = inserted
                pendingDeletesThisRound[table] = deleted
                if slice.hasMore { anyHasMore = true }
            }

            // Advance cursors in the same context transaction as the rows
            // — save() below commits them atomically, so we can't end up
            // with "cursor advanced, rows lost" or "rows inserted, cursor
            // stale."
            for (table, cursor) in response.cursors {
                upsertCursor(
                    tableName: table,
                    lastSyncedAt: cursor,
                    cache: &cursorCache
                )
            }

            do {
                try context.save()
            } catch {
                // Propagate: outer SyncManager will surface the error and
                // the next sync starts from the same cursor (idempotent).
                BrettLog.pull.error("pull save failed: \(String(describing: error), privacy: .public)")
                recordPullFailure(error: error)
                throw PullError.savePersistFailed(underlying: error)
            }

            // Only now that the save succeeded do we count these rows as
            // "imported." If the save had failed the tables would still be
            // counted as 0 and the caller's observer wouldn't be misled.
            for (table, n) in pendingUpsertsThisRound {
                tablesUpserted[table, default: 0] += n
            }
            for (table, n) in pendingDeletesThisRound {
                tablesDeleted[table, default: 0] += n
            }

            if !anyHasMore { break }
        }

        recordPullSuccess()

        return PullOutcome(
            tablesUpserted: tablesUpserted,
            tablesDeleted: tablesDeleted,
            fullResync: false
        )
    }

    // MARK: - Cursor ops

    /// Load every SyncCursor row into a dictionary keyed by tableName.
    /// Called once per pull; subsequent reads/writes use the cache so we
    /// avoid the old O(rounds × tables) linear-scan pattern.
    private func loadCursorCache() -> [String: SyncCursor] {
        let rows: [SyncCursor]
        do {
            rows = try context.fetch(FetchDescriptor<SyncCursor>())
        } catch {
            BrettLog.pull.error("loadCursorCache fetch failed: \(String(describing: error), privacy: .public)")
            rows = []
        }
        return Dictionary(uniqueKeysWithValues: rows.map { ($0.tableName, $0) })
    }

    /// Build the cursor map the server expects. Tables without a row in
    /// `SyncCursor` send `null` (first sync).
    private func cursorMap(from cache: [String: SyncCursor]) -> [String: String?] {
        var byTable: [String: String?] = [:]
        for table in SyncProtocol.tables {
            byTable[table] = cache[table]?.lastSyncedAt
        }
        return byTable
    }

    /// Insert or update the `SyncCursor` row for a table, keeping the
    /// per-pull cache consistent so the next round sees the new value
    /// without a refetch.
    private func upsertCursor(
        tableName: String,
        lastSyncedAt: String,
        cache: inout [String: SyncCursor]
    ) {
        if let existing = cache[tableName] {
            existing.lastSyncedAt = lastSyncedAt
            existing.isInitialSyncComplete = true
        } else {
            let new = SyncCursor(
                tableName: tableName,
                lastSyncedAt: lastSyncedAt,
                isInitialSyncComplete: true
            )
            context.insert(new)
            cache[tableName] = new
        }
    }

    /// Wipe every cursor + mark the initial-sync complete flag off.
    /// Called when the server responds `fullSyncRequired=true`.
    private func resetAllCursors() {
        let rows: [SyncCursor]
        do {
            rows = try context.fetch(FetchDescriptor<SyncCursor>())
        } catch {
            BrettLog.pull.error("resetAllCursors fetch failed: \(String(describing: error), privacy: .public)")
            return
        }
        for row in rows {
            row.lastSyncedAt = nil
            row.isInitialSyncComplete = false
        }
        do {
            try context.save()
        } catch {
            BrettLog.pull.error("resetAllCursors save failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// When the server signals `fullSyncRequired`, wipe local rows for the
    /// sync-managed tables so a subsequent pull starts from an empty
    /// mirror. Without this, rows that were deleted server-side linger
    /// locally and briefly render as ghost entries — the audit's Medium
    /// #11 item.
    ///
    /// Local pending mutations (rows with `_syncStatus != synced`) survive
    /// the wipe: the user may be offline with unpushed writes and we can't
    /// drop those silently. The next successful push flushes them.
    private func wipeLocalRecordsForFullResync() {
        wipeSyncedRows(Item.self)
        wipeSyncedRows(ItemList.self)
        wipeSyncedRows(CalendarEvent.self)
        wipeSyncedRows(CalendarEventNote.self)
        wipeSyncedRows(Scout.self)
        wipeSyncedRows(ScoutFinding.self)
        wipeSyncedRows(BrettMessage.self)
        wipeSyncedRows(Attachment.self)

        do {
            try context.save()
        } catch {
            BrettLog.pull.error("wipeLocalRecordsForFullResync save failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// Delete every row of `T` whose `_syncStatus` is `synced`. Unsynced
    /// rows (pending creates/updates/deletes) are preserved so the user's
    /// offline edits aren't dropped on a server-initiated resync.
    private func wipeSyncedRows<T: SyncTrackedModel>(_ type: T.Type) {
        // #Predicate doesn't range-bind a protocol requirement cleanly,
        // so we fetch and filter in Swift. Full resync is rare and the
        // row count is bounded by one user's local mirror.
        let descriptor = FetchDescriptor<T>()
        let rows: [T]
        do {
            rows = try context.fetch(descriptor)
        } catch {
            BrettLog.pull.error("wipeSyncedRows fetch \(String(describing: type)) failed: \(String(describing: error), privacy: .public)")
            return
        }
        for row in rows where row.syncStatus == .synced {
            context.delete(row)
        }
    }

    // MARK: - SyncHealth

    private func markPulling(_ value: Bool) {
        let health = fetchHealth()
        health.isPulling = value
    }

    private func recordPullSuccess() {
        let health = fetchHealth()
        health.lastSuccessfulPullAt = Date()
        health.isPulling = false
        health.consecutiveFailures = 0
        health.lastError = nil
        do {
            try context.save()
        } catch {
            BrettLog.pull.error("recordPullSuccess save failed: \(String(describing: error), privacy: .public)")
        }
    }

    private func recordPullFailure(error: Error?) {
        let health = fetchHealth()
        health.isPulling = false
        if let error {
            health.consecutiveFailures += 1
            health.lastError = String(describing: error)
        }
        do {
            try context.save()
        } catch {
            BrettLog.pull.error("recordPullFailure save failed: \(String(describing: error), privacy: .public)")
        }
    }

    private func fetchHealth() -> SyncHealth {
        let rows: [SyncHealth]
        do {
            rows = try context.fetch(FetchDescriptor<SyncHealth>())
        } catch {
            BrettLog.pull.error("fetchHealth fetch failed: \(String(describing: error), privacy: .public)")
            rows = []
        }
        if let existing = rows.first { return existing }
        let created = SyncHealth()
        context.insert(created)
        return created
    }
}
