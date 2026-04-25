import Testing
import Foundation
import SwiftData
@testable import Brett

/// Verifies cursor handling, local-pending protection, tombstone deletion,
/// and the `fullSyncRequired` reset path for the pull engine.
@Suite("PullEngine", .tags(.sync), .serialized)
@MainActor
struct PullEngineTests {
    /// Reset MockURLProtocol before every test so a stale stub or recorded
    /// request from another suite doesn't bleed in.
    init() { MockURLProtocol.reset() }

    /// Compute the URL the APIClient will POST to, matching the rules in
    /// `APIClient.rawRequest` so stubs match regardless of the `BrettAPIURL`
    /// resolved from the bundle at test time.
    private var pullURL: URL {
        let client = APIClient(session: .shared)
        return client.baseURL.appendingPathComponent("sync/pull")
    }

    /// Build an APIClient backed by `MockURLProtocol`. Does NOT reset the
    /// stub registry — callers are responsible for resetting at the start of
    /// their test setup so any stubs registered later survive until the
    /// request actually fires.
    private func makeStubbedClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return APIClient(session: URLSession(configuration: config))
    }

    /// Reset the MockURLProtocol registry and register a single /sync/pull
    /// stub. Calling this at the top of each test keeps test isolation tight
    /// even when the suite runs parallel harness rounds.
    private func stubPull(_ body: [String: Any]) throws {
        MockURLProtocol.reset()
        MockURLProtocol.stub(
            url: pullURL,
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: body)
        )
    }

    /// Canonical skeleton for a /sync/pull response with all tables empty.
    /// Tests override specific tables before stubbing.
    private func emptyPullBody() -> [String: Any] {
        var changes: [String: Any] = [:]
        for table in SyncProtocol.tables {
            changes[table] = [
                "upserted": [],
                "deleted": [],
                "hasMore": false,
            ]
        }
        return [
            "changes": changes,
            "cursors": [:],
            "serverTime": "2026-04-14T12:00:00.000Z",
            "fullSyncRequired": false,
        ]
    }

    // MARK: - Upsert new record

    @Test func upsertInsertsNewLocalRecord() async throws {
        let context = try InMemoryPersistenceController.makeContext()

        var body = emptyPullBody()
        var changes = body["changes"] as! [String: Any]
        changes["items"] = [
            "upserted": [[
                "id": "item-100",
                "userId": "user-1",
                "type": "task",
                "status": "active",
                "title": "Pulled from server",
                "source": "Brett",
                "createdAt": "2026-04-14T00:00:00.000Z",
                "updatedAt": "2026-04-14T11:30:00.000Z",
            ]],
            "deleted": [],
            "hasMore": false,
        ]
        body["changes"] = changes
        body["cursors"] = ["items": "2026-04-14T11:30:00.000Z"]
        try stubPull(body)

        let engine = PullEngine(apiClient: makeStubbedClient(), context: context)
        let outcome = try await engine.pull()

        #expect(outcome.tablesUpserted["items"] == 1)
        #expect(!outcome.fullResync)

        let items: [Item] = (try? context.fetch(FetchDescriptor<Item>())) ?? []
        #expect(items.count == 1)
        #expect(items.first?.title == "Pulled from server")
        #expect(items.first?._syncStatus == SyncStatus.synced.rawValue)

        // Cursor should be persisted.
        let cursors: [SyncCursor] = (try? context.fetch(FetchDescriptor<SyncCursor>())) ?? []
        #expect(cursors.first(where: { $0.tableName == "items" })?.lastSyncedAt == "2026-04-14T11:30:00.000Z")
        #expect(cursors.first(where: { $0.tableName == "items" })?.isInitialSyncComplete == true)
    }

    // MARK: - Local pending protection

    @Test func upsertSkipsLocalPendingRecord() async throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Seed a local Item that has uncommitted local changes.
        let existing = Item(id: "item-100", userId: "user-1", title: "Local pending title")
        existing._syncStatus = SyncStatus.pendingUpdate.rawValue
        context.insert(existing)
        try context.save()

        var body = emptyPullBody()
        var changes = body["changes"] as! [String: Any]
        changes["items"] = [
            "upserted": [[
                "id": "item-100",
                "userId": "user-1",
                "type": "task",
                "status": "active",
                "title": "Server title",
                "source": "Brett",
                "createdAt": "2026-04-14T00:00:00.000Z",
                "updatedAt": "2026-04-14T11:30:00.000Z",
            ]],
            "deleted": [],
            "hasMore": false,
        ]
        body["changes"] = changes
        body["cursors"] = ["items": "2026-04-14T11:30:00.000Z"]
        try stubPull(body)

        let engine = PullEngine(apiClient: makeStubbedClient(), context: context)
        _ = try await engine.pull()

        // Local title should NOT have been overwritten.
        let items: [Item] = (try? context.fetch(FetchDescriptor<Item>())) ?? []
        #expect(items.first?.title == "Local pending title")
        #expect(items.first?._syncStatus == SyncStatus.pendingUpdate.rawValue)
    }

    // MARK: - Tombstone authority

    @Test func deletedIdsHardDeleteRegardlessOfLocalStatus() async throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Local record with a pending-update status. A tombstone pull should
        // still wipe it — pulls are authoritative for deletions.
        let local = Item(id: "item-doomed", userId: "user-1", title: "Going away")
        local._syncStatus = SyncStatus.pendingUpdate.rawValue
        context.insert(local)
        try context.save()

        var body = emptyPullBody()
        var changes = body["changes"] as! [String: Any]
        changes["items"] = [
            "upserted": [],
            "deleted": ["item-doomed"],
            "hasMore": false,
        ]
        body["changes"] = changes
        try stubPull(body)

        let engine = PullEngine(apiClient: makeStubbedClient(), context: context)
        let outcome = try await engine.pull()

        #expect(outcome.tablesDeleted["items"] == 1)

        let items: [Item] = (try? context.fetch(FetchDescriptor<Item>())) ?? []
        #expect(items.isEmpty)
    }

    // MARK: - Cursor advancement (no-op but cursor still stored)

    @Test func cursorAdvancesEvenWithEmptyChanges() async throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Already-seeded cursor so we confirm it gets updated.
        let seed = SyncCursor(tableName: "items", lastSyncedAt: "2026-04-01T00:00:00.000Z")
        context.insert(seed)
        try context.save()

        var body = emptyPullBody()
        body["cursors"] = ["items": "2026-04-14T12:00:00.000Z"]
        try stubPull(body)

        let engine = PullEngine(apiClient: makeStubbedClient(), context: context)
        _ = try await engine.pull()

        let cursors: [SyncCursor] = (try? context.fetch(FetchDescriptor<SyncCursor>())) ?? []
        #expect(cursors.first(where: { $0.tableName == "items" })?.lastSyncedAt == "2026-04-14T12:00:00.000Z")
    }

    // MARK: - fullSyncRequired

    @Test func fullSyncRequiredClearsCursorsAndReports() async throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Seed cursors for every table so we can verify they all reset.
        for table in SyncProtocol.tables {
            context.insert(SyncCursor(
                tableName: table,
                lastSyncedAt: "2026-01-01T00:00:00.000Z",
                isInitialSyncComplete: true
            ))
        }
        try context.save()

        let body: [String: Any] = [
            "changes": [:],
            "cursors": [:],
            "serverTime": "2026-04-14T12:00:00.000Z",
            "fullSyncRequired": true,
        ]
        try stubPull(body)

        let engine = PullEngine(apiClient: makeStubbedClient(), context: context)
        let outcome = try await engine.pull()

        #expect(outcome.fullResync)

        let cursors: [SyncCursor] = (try? context.fetch(FetchDescriptor<SyncCursor>())) ?? []
        for row in cursors {
            #expect(row.lastSyncedAt == nil)
            #expect(row.isInitialSyncComplete == false)
        }
    }

    // MARK: - Multi-round (hasMore)

    /// Cursor-stuck detection — if a single table reports `hasMore=true`
    /// but its cursor doesn't advance between rounds, the engine must
    /// bail rather than infinite-loop. With the post-fix server, this
    /// scenario is impossible under correct operation; the test still
    /// pins the safety net so a future server regression doesn't lock
    /// up the client.
    ///
    /// Mechanism: stub once with `hasMore=true` and a fixed cursor.
    /// Round 1 advances the local cursor from nil → that fixed value;
    /// round 2 sees `cursorsBefore[items] == cursorsAfter[items]` and
    /// throws `PullError.cursorStuck(table: "items")`.
    @Test func cursorStuckDetectionPreventsInfiniteLoop() async throws {
        let context = try InMemoryPersistenceController.makeContext()

        var body = emptyPullBody()
        var changes = body["changes"] as! [String: Any]
        changes["items"] = [
            "upserted": [[
                "id": "item-200",
                "userId": "user-1",
                "type": "task",
                "status": "active",
                "title": "Batch 1",
                "source": "Brett",
                "createdAt": "2026-04-14T00:00:00.000Z",
                "updatedAt": "2026-04-14T11:30:00.000Z",
            ]],
            "deleted": [],
            "hasMore": true, // server claims more, but cursor below never moves
        ]
        body["changes"] = changes
        body["cursors"] = ["items": "2026-04-14T11:30:00.000Z|stuck"]
        try stubPull(body)

        let engine = PullEngine(apiClient: makeStubbedClient(), context: context)

        do {
            _ = try await engine.pull()
            Issue.record("expected cursorStuck error")
        } catch let err as PullEngine.PullError {
            if case .cursorStuck(_, let table) = err {
                #expect(table == "items", "cursorStuck should identify the broken table")
                // Confirm the engine made exactly two HTTP calls
                // (round 1 advanced the cursor, round 2 detected stuck).
                let requests = MockURLProtocol.recordedRequests()
                    .filter { $0.url?.path == "/sync/pull" }
                #expect(requests.count == 2)
            } else {
                Issue.record("expected cursorStuck error, got \(err)")
            }
        } catch {
            Issue.record("expected PullEngine.PullError, got \(error)")
        }
    }

    /// Cursor-stuck must fire even when only ONE table is broken and
    /// others are still making progress. Without this check, a single
    /// stuck table would let the engine spin against
    /// `safetyRoundCap` (1000 rounds) before giving up — many minutes
    /// of wasted round-trips behind the rate limiter.
    ///
    /// Mechanism: items has `hasMore=true` with a frozen cursor; lists
    /// has `hasMore=false`. Pre-fix (whole-dict equality), only the
    /// items cursor freezing wouldn't matter because lists' cursor
    /// also wouldn't advance — the global compare would not catch the
    /// items-only failure. Post-fix the per-table check fires on items
    /// regardless of lists' state.
    @Test func cursorStuckFiresWhenOneTableStuckOthersProgressing() async throws {
        let context = try InMemoryPersistenceController.makeContext()

        var body = emptyPullBody()
        var changes = body["changes"] as! [String: Any]
        // items: hasMore=true, frozen cursor.
        changes["items"] = [
            "upserted": [[
                "id": "item-stuck",
                "userId": "user-1",
                "type": "task",
                "status": "active",
                "title": "Stuck",
                "source": "Brett",
                "createdAt": "2026-04-14T00:00:00.000Z",
                "updatedAt": "2026-04-14T11:30:00.000Z",
            ]],
            "deleted": [],
            "hasMore": true,
        ]
        // lists: hasMore=false (this table converged), but a row was
        // returned so its cursor moved — proves the per-table check
        // doesn't false-fire on healthy tables.
        changes["lists"] = [
            "upserted": [[
                "id": "list-1",
                "userId": "user-1",
                "name": "Work",
                "colorClass": "bg-blue-500",
                "sortOrder": 0,
                "createdAt": "2026-04-14T00:00:00.000Z",
                "updatedAt": "2026-04-14T11:00:00.000Z",
            ]],
            "deleted": [],
            "hasMore": false,
        ]
        body["changes"] = changes
        body["cursors"] = [
            "items": "2026-04-14T11:30:00.000Z|stuck",
            "lists": "2026-04-14T11:00:00.000Z|list-1",
        ]
        try stubPull(body)

        let engine = PullEngine(apiClient: makeStubbedClient(), context: context)

        do {
            _ = try await engine.pull()
            Issue.record("expected cursorStuck for items")
        } catch let err as PullEngine.PullError {
            if case .cursorStuck(_, let table) = err {
                #expect(table == "items", "items is the stuck table; lists progressed normally")
            } else {
                Issue.record("expected cursorStuck error, got \(err)")
            }
        } catch {
            Issue.record("expected PullEngine.PullError, got \(error)")
        }
    }

    /// `cursorStuck` is a real failure — `consecutiveFailures` must
    /// increment so the foreground poll backs off rather than retrying
    /// in a tight loop against a server that's currently broken.
    @Test func cursorStuckIncrementsConsecutiveFailures() async throws {
        let context = try InMemoryPersistenceController.makeContext()

        var body = emptyPullBody()
        var changes = body["changes"] as! [String: Any]
        changes["items"] = [
            "upserted": [[
                "id": "item-stuck",
                "userId": "user-1",
                "type": "task",
                "status": "active",
                "title": "Stuck",
                "source": "Brett",
                "createdAt": "2026-04-14T00:00:00.000Z",
                "updatedAt": "2026-04-14T11:30:00.000Z",
            ]],
            "deleted": [],
            "hasMore": true,
        ]
        body["changes"] = changes
        body["cursors"] = ["items": "2026-04-14T11:30:00.000Z|stuck"]
        try stubPull(body)

        let engine = PullEngine(apiClient: makeStubbedClient(), context: context)

        do {
            _ = try await engine.pull()
            Issue.record("expected throw")
        } catch {
            // Expected
        }

        let health: [SyncHealth] = (try? context.fetch(FetchDescriptor<SyncHealth>())) ?? []
        #expect(health.count == 1)
        #expect((health.first?.consecutiveFailures ?? 0) >= 1,
                "cursorStuck must bump consecutiveFailures so poll backoff kicks in")
        #expect(health.first?.lastError != nil)
    }

    // MARK: - SyncHealth touched on success

    @Test func successfulPullUpdatesSyncHealth() async throws {
        let context = try InMemoryPersistenceController.makeContext()

        let body = emptyPullBody()
        try stubPull(body)

        let engine = PullEngine(apiClient: makeStubbedClient(), context: context)
        _ = try await engine.pull()

        let health: [SyncHealth] = (try? context.fetch(FetchDescriptor<SyncHealth>())) ?? []
        #expect(health.count == 1)
        #expect(health.first?.lastSuccessfulPullAt != nil)
        #expect(health.first?.consecutiveFailures == 0)
    }
}
