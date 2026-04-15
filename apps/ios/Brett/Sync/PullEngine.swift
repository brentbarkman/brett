import Foundation
import SwiftData

/// Fetches server-side changes via `/sync/pull` and reconciles them with
/// local SwiftData state.
///
/// Rules:
///  - Read per-table cursors from `SyncCursor`. Missing → `null`.
///  - POST `/sync/pull`. On `fullSyncRequired=true`, wipe cursors and bail.
///  - Upsert per table, skipping any local record whose `_syncStatus` is not
///    `synced` (we don't clobber pending local writes).
///  - Hard-delete on tombstones regardless of local state (pulls are
///    authoritative for deletions).
///  - Advance each table's cursor to the value the server sent back.
///  - Loop up to `maxRounds` times if any table reports `hasMore=true`.
///  - Update `SyncHealth.lastSuccessfulPullAt` on success.
@MainActor
final class PullEngine {
    // MARK: - Inputs

    private let apiClient: APIClient
    private let context: ModelContext

    // MARK: - Summary

    struct PullOutcome: Equatable {
        /// Upserts applied per table (skipped records are excluded).
        let tablesUpserted: [String: Int]
        /// Hard deletions per table.
        let tablesDeleted: [String: Int]
        /// `true` when the server asked the client to wipe cursors and
        /// re-pull from scratch. The caller should decide whether to retry.
        let fullResync: Bool

        static let empty = PullOutcome(tablesUpserted: [:], tablesDeleted: [:], fullResync: false)
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

        for _ in 0..<maxRounds {
            let cursors = currentCursors()
            let response: SyncPullResponse

            do {
                response = try await apiClient.syncPull(cursors: cursors)
            } catch {
                recordPullFailure(error: error)
                throw error
            }

            if response.fullSyncRequired {
                resetAllCursors()
                recordPullFailure(error: nil) // not a real failure, just bail
                return PullOutcome(
                    tablesUpserted: tablesUpserted,
                    tablesDeleted: tablesDeleted,
                    fullResync: true
                )
            }

            var anyHasMore = false

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
                }

                var deleted = 0
                for id in slice.deleted {
                    SyncEntityMapper.hardDelete(
                        tableName: table,
                        id: id,
                        context: context
                    )
                    deleted += 1
                }

                tablesUpserted[table, default: 0] += inserted
                tablesDeleted[table, default: 0] += deleted
                if slice.hasMore { anyHasMore = true }
            }

            // Advance cursors. Only tables with activity are present in
            // `response.cursors`; others keep their previous value.
            for (table, cursor) in response.cursors {
                upsertCursor(tableName: table, lastSyncedAt: cursor)
            }

            try? context.save()

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

    /// Build the cursor map the server expects. Tables without a row in
    /// `SyncCursor` send `null` (first sync).
    private func currentCursors() -> [String: String?] {
        let rows = (try? context.fetch(FetchDescriptor<SyncCursor>())) ?? []
        var byTable: [String: String?] = [:]
        for table in SyncProtocol.tables {
            byTable[table] = rows.first(where: { $0.tableName == table })?.lastSyncedAt
        }
        return byTable
    }

    /// Insert or update the `SyncCursor` row for a table.
    private func upsertCursor(tableName: String, lastSyncedAt: String) {
        let rows = (try? context.fetch(FetchDescriptor<SyncCursor>())) ?? []
        if let existing = rows.first(where: { $0.tableName == tableName }) {
            existing.lastSyncedAt = lastSyncedAt
            existing.isInitialSyncComplete = true
        } else {
            let new = SyncCursor(
                tableName: tableName,
                lastSyncedAt: lastSyncedAt,
                isInitialSyncComplete: true
            )
            context.insert(new)
        }
    }

    /// Wipe every cursor + mark the initial-sync complete flag off.
    /// Called when the server responds `fullSyncRequired=true`.
    private func resetAllCursors() {
        let rows = (try? context.fetch(FetchDescriptor<SyncCursor>())) ?? []
        for row in rows {
            row.lastSyncedAt = nil
            row.isInitialSyncComplete = false
        }
        try? context.save()
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
        try? context.save()
    }

    private func recordPullFailure(error: Error?) {
        let health = fetchHealth()
        health.isPulling = false
        if let error {
            health.consecutiveFailures += 1
            health.lastError = String(describing: error)
        }
        try? context.save()
    }

    private func fetchHealth() -> SyncHealth {
        let rows = (try? context.fetch(FetchDescriptor<SyncHealth>())) ?? []
        if let existing = rows.first { return existing }
        let created = SyncHealth()
        context.insert(created)
        return created
    }
}
