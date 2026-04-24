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

    @Test func hasMoreTriggersAdditionalRounds() async throws {
        let context = try InMemoryPersistenceController.makeContext()

        // We can't change the stubbed response mid-test with MockURLProtocol
        // (same URL → same stub). Instead, stub once with `hasMore = false`
        // and assert the engine uses the stub once; for multi-round we rely
        // on the engine's deterministic loop-until-false logic, which is
        // covered by the functional test below using `hasMore = true` on
        // the first (and only) stub — the loop should bail after
        // `maxRounds` without spinning forever.

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
            "hasMore": true, // server says "more to fetch"
        ]
        body["changes"] = changes
        body["cursors"] = ["items": "2026-04-14T11:30:00.000Z"]
        try stubPull(body)

        let engine = PullEngine(apiClient: makeStubbedClient(), context: context)
        // With maxRounds=3 the loop should fire the stub 3 times and stop
        // without infinite recursion, even though every response says hasMore.
        let outcome = try await engine.pull(maxRounds: 3)

        // Exactly one local upsert (same record id), after 3 requests.
        let items: [Item] = (try? context.fetch(FetchDescriptor<Item>())) ?? []
        #expect(items.count == 1)
        #expect(items.first?.title == "Batch 1")
        #expect(outcome.tablesUpserted["items"] == 3)
        // Recorded 3 HTTP POSTs to /sync/pull — proof the loop honoured hasMore.
        let requests = MockURLProtocol.recordedRequests()
            .filter { $0.url?.path == "/sync/pull" }
        #expect(requests.count == 3)
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
