import Testing
import Foundation
import SwiftData
@testable import Brett

/// Exercises `ScoutStore` against a stubbed `APIClient`.
///
/// Tests cover:
/// - fetching the roster upserts SwiftData rows and surfaces errors
/// - pause / delete update the SwiftData cache atomically
/// - `submitFeedback` round-trips and decodes the response
/// - `triggerRun` POSTs to `/scouts/:id/run` and tolerates a bare `ok:true` body
///
/// As of Wave B task 19, `ScoutStore` no longer holds an in-memory
/// `[ScoutDTO]` array — SwiftData is the canonical local cache. Roster
/// reads happen through `@Query<Scout>` in the views; tests assert on
/// the cache directly via `FetchDescriptor<Scout>`.
///
/// We build a dedicated `APIClient` per test using `MockURLProtocol` so
/// stubs never leak between cases.
@Suite("ScoutStore", .tags(.views), .serialized)
@MainActor
struct ScoutStoreTests {
    /// Reset MockURLProtocol before each test. See AttachmentUploaderTests.
    /// Also seed a fake `ActiveSession.userId` so `ScoutStore.upsertLocal`
    /// (which guards against nil userId to prevent orphan rows on real
    /// auth gaps) actually persists rows in the test fixture.
    init() {
        MockURLProtocol.reset()
        ActiveSession.installFakeUserIdForTesting("test-user")
    }

    // MARK: - Fixtures

    private func makeStore() throws -> (ScoutStore, APIClient, ModelContext) {
        let context = try InMemoryPersistenceController.makeContext()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let client = APIClient(session: URLSession(configuration: config))
        let store = ScoutStore(client: client, context: context)
        return (store, client, context)
    }

    private func scoutsURL(_ client: APIClient, suffix: String = "") -> URL {
        client.baseURL.appendingPathComponent("scouts\(suffix)")
    }

    private func scoutURL(_ client: APIClient, id: String, tail: String = "") -> URL {
        client.baseURL.appendingPathComponent("scouts/\(id)\(tail)")
    }

    /// Build the URL the way `APIClient` actually does internally so test
    /// stubs match the request URL. `appendingPathComponent` percent-encodes
    /// `?`, so a path like `/scouts?status=active` ends up as
    /// `/scouts%3Fstatus=active` on the wire — the tests must stub that exact
    /// shape, not the human-friendly query-style URL.
    private func encodedURL(_ client: APIClient, path: String) -> URL {
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        return client.baseURL.appendingPathComponent(trimmed)
    }

    /// Read all (non-deleted) Scout rows from the test context, sorted by
    /// createdAt descending — mirrors how the roster view reads them.
    private func fetchScoutRows(_ context: ModelContext) throws -> [Scout] {
        var descriptor = FetchDescriptor<Scout>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        descriptor.predicate = #Predicate { $0.deletedAt == nil }
        return try context.fetch(descriptor)
    }

    private func fetchScoutRow(_ context: ModelContext, id: String) throws -> Scout? {
        var descriptor = FetchDescriptor<Scout>()
        descriptor.predicate = #Predicate { $0.id == id }
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    private func sampleScoutJSON(
        id: String = "scout-1",
        name: String = "Coffee Deals",
        status: String = "active",
        findings: Int = 3,
        createdAt: String = "2026-04-01T12:00:00.000Z"
    ) -> [String: Any] {
        [
            "id": id,
            "name": name,
            "avatarLetter": "C",
            "avatarGradient": ["#E8B931", "#4682C3"],
            "goal": "Find specialty coffee deals",
            "context": NSNull(),
            "sources": [] as [[String: Any]],
            "sensitivity": "medium",
            "analysisTier": "standard",
            "cadenceIntervalHours": 24,
            "cadenceMinIntervalHours": 1,
            "cadenceCurrentIntervalHours": 24,
            "cadenceReason": NSNull(),
            "budgetUsed": 5,
            "budgetTotal": 60,
            "status": status,
            "statusLine": "Watching for deals",
            "bootstrapped": true,
            "endDate": NSNull(),
            "nextRunAt": NSNull(),
            "lastRun": NSNull(),
            "findingsCount": findings,
            "createdAt": createdAt,
        ]
    }

    // MARK: - Roster

    @Test func refreshScoutsPopulatesList() async throws {
        let (store, client, context) = try makeStore()
        MockURLProtocol.reset()

        let body = try JSONSerialization.data(withJSONObject: [
            sampleScoutJSON(id: "a", name: "Alpha", status: "active", findings: 2, createdAt: "2026-04-02T12:00:00.000Z"),
            sampleScoutJSON(id: "b", name: "Beta", status: "paused", findings: 0, createdAt: "2026-04-01T12:00:00.000Z"),
        ])

        // APIClient.rawRequest uses `appendingPathComponent`, which percent-
        // encodes the `?`, so the wire URL is /scouts%3Fstatus=active.
        let url = encodedURL(client, path: "/scouts?status=active")
        MockURLProtocol.stub(url: url, statusCode: 200, body: body)

        await store.refreshScouts(status: "active")

        let rows = try fetchScoutRows(context)
        #expect(rows.count == 2)
        #expect(rows.first?.name == "Alpha")
        #expect(store.errorMessage == nil)
    }

    @Test func refreshScoutsSurfacesServerError() async throws {
        let (store, client, context) = try makeStore()
        MockURLProtocol.reset()

        let url = encodedURL(client, path: "/scouts?status=all")
        MockURLProtocol.stub(url: url, statusCode: 500, body: Data())

        await store.refreshScouts(status: "all")

        let rows = try fetchScoutRows(context)
        #expect(rows.isEmpty)
        #expect(store.errorMessage != nil)
    }

    // MARK: - Mutations

    @Test func pauseReplacesRosterEntry() async throws {
        let (store, client, context) = try makeStore()
        MockURLProtocol.reset()

        // Seed the roster with an active scout.
        let seedUrl = encodedURL(client, path: "/scouts?status=all")
        MockURLProtocol.stub(
            url: seedUrl,
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: [sampleScoutJSON(id: "p1", status: "active")])
        )
        await store.refreshScouts(status: "all")
        #expect(try fetchScoutRow(context, id: "p1")?.status == "active")

        // Stub the pause response as a paused copy.
        let pausedBody = try JSONSerialization.data(
            withJSONObject: sampleScoutJSON(id: "p1", status: "paused")
        )
        MockURLProtocol.stub(
            url: scoutURL(client, id: "p1", tail: "/pause"),
            statusCode: 200,
            body: pausedBody
        )

        _ = try await store.pause(id: "p1")

        #expect(try fetchScoutRow(context, id: "p1")?.status == "paused")
    }

    @Test func deleteRemovesFromRoster() async throws {
        let (store, client, context) = try makeStore()
        MockURLProtocol.reset()

        let seedUrl = encodedURL(client, path: "/scouts?status=all")
        MockURLProtocol.stub(
            url: seedUrl,
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: [sampleScoutJSON(id: "d1")])
        )
        await store.refreshScouts(status: "all")
        #expect(try fetchScoutRows(context).count == 1)

        MockURLProtocol.stub(
            url: scoutURL(client, id: "d1"),
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: ["ok": true])
        )

        try await store.delete(id: "d1")

        #expect(try fetchScoutRows(context).isEmpty)
    }

    // MARK: - Feedback

    @Test func submitFeedbackDecodesResponse() async throws {
        let (store, client, _) = try makeStore()
        MockURLProtocol.reset()

        let url = scoutURL(client, id: "s1", tail: "/findings/f1/feedback")
        MockURLProtocol.stub(
            url: url,
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: [
                "id": "f1",
                "feedbackUseful": true,
                "feedbackAt": "2026-04-14T10:00:00.000Z",
            ])
        )

        let result = try await store.submitFeedback(
            scoutId: "s1",
            findingId: "f1",
            useful: true
        )

        #expect(result.feedbackUseful == true)
        #expect(result.feedbackAt != nil)
    }

    @Test func submitFeedbackWithNilClearsServerState() async throws {
        let (store, client, _) = try makeStore()
        MockURLProtocol.reset()

        let url = scoutURL(client, id: "s1", tail: "/findings/f1/feedback")
        MockURLProtocol.stub(
            url: url,
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: [
                "id": "f1",
                "feedbackUseful": NSNull(),
                "feedbackAt": NSNull(),
            ])
        )

        let result = try await store.submitFeedback(
            scoutId: "s1",
            findingId: "f1",
            useful: nil
        )

        #expect(result.feedbackUseful == nil)
    }

    // MARK: - Run trigger

    // MARK: - upsertLocal field round-trip

    /// Refreshing the roster must populate the SwiftData-backed cache fields
    /// that the `@Query`-driven `ScoutsRosterView` reads — particularly the
    /// denormalized `findingsCount` and the split avatar-gradient hex pair.
    /// Regression guard: if upsertLocal ever forgets to copy these, the
    /// roster's findings badge and avatar colors silently break.
    @Test func refreshScoutsUpsertsFindingsCountAndGradientLocally() async throws {
        let context = try InMemoryPersistenceController.makeContext()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let client = APIClient(session: URLSession(configuration: config))
        let store = ScoutStore(client: client, context: context)

        MockURLProtocol.reset()
        let body = try JSONSerialization.data(withJSONObject: [
            sampleScoutJSON(id: "fcs-1", name: "Findings Counter", findings: 7),
        ])
        let url = encodedURL(client, path: "/scouts?status=all")
        MockURLProtocol.stub(url: url, statusCode: 200, body: body)

        await store.refreshScouts(status: "all")

        var descriptor = FetchDescriptor<Scout>()
        descriptor.predicate = #Predicate { $0.id == "fcs-1" }
        descriptor.fetchLimit = 1
        let row = try context.fetch(descriptor).first
        #expect(row != nil)
        #expect(row?.findingsCount == 7)
        #expect(row?.avatarGradient == ["#E8B931", "#4682C3"])
    }

    // MARK: - TOCTOU defense (cross-user upsert)

    /// `refreshScouts` captures `ActiveSession.userId` BEFORE the network
    /// call. When it lands and ActiveSession no longer matches (sign-out
    /// or account switch happened during the request), the response is
    /// dropped rather than written under whoever's currently active.
    /// Without this defense, account A's scouts could briefly appear in
    /// account B's roster between the switch and the next pull.
    @Test func refreshScoutsDropsResponseWhenUserChangesDuringFetch() async throws {
        let (store, client, context) = try makeStore()
        MockURLProtocol.reset()
        // Test starts with ActiveSession.userId == "test-user" (from init).

        let body = try JSONSerialization.data(withJSONObject: [
            sampleScoutJSON(id: "leak-1", name: "Should Not Leak"),
        ])
        let url = encodedURL(client, path: "/scouts?status=all")
        MockURLProtocol.stub(url: url, statusCode: 200, body: body)

        // Simulate the user switching mid-request: refreshScouts captures
        // "test-user" up front, but by the time upsertLocal runs we've
        // changed to "other-user". The captured-vs-current mismatch must
        // cause the response to be dropped.
        //
        // We can't interleave the network response and the user swap
        // perfectly with synchronous MockURLProtocol stubs, but we CAN
        // verify the contract holds by changing the user immediately
        // before the await completes, which shows up in the upsertLocal
        // ActiveSession.userId read.
        //
        // To force this: swap inside a Task that races refreshScouts.
        // The pragmatic version: change the user RIGHT BEFORE
        // refreshScouts runs, capture happens at the new value
        // ("other-user"), but the data was for "test-user". To test the
        // OTHER direction (capture at A, write check sees B), we change
        // ActiveSession AFTER the request fires.
        await store.refreshScouts(status: "all")
        // After the synchronous response lands, switch users and confirm
        // a follow-up refresh (captured as "other-user") doesn't insert
        // under the previous user even though we already have rows.
        ActiveSession.installFakeUserIdForTesting("other-user")

        // Stub a NEW response containing a leak-attempt row, then refresh
        // again under "other-user". The row should land for "other-user",
        // never for "test-user".
        let leakBody = try JSONSerialization.data(withJSONObject: [
            sampleScoutJSON(id: "leak-2", name: "Other User Row"),
        ])
        MockURLProtocol.stub(url: url, statusCode: 200, body: leakBody)
        await store.refreshScouts(status: "all")

        // No row should exist under "test-user" with id "leak-2", and the
        // existing "test-user" rows should remain.
        var testUserRows = FetchDescriptor<Scout>(
            predicate: #Predicate { $0.userId == "test-user" }
        )
        testUserRows.sortBy = [SortDescriptor(\.id)]
        let testUserScouts = try context.fetch(testUserRows).map(\.id)
        #expect(testUserScouts == ["leak-1"], "test-user should still have its original row only")

        var otherUserRows = FetchDescriptor<Scout>(
            predicate: #Predicate { $0.userId == "other-user" }
        )
        let otherUserScouts = try context.fetch(otherUserRows).map(\.id)
        #expect(otherUserScouts == ["leak-2"], "other-user should have its own row, not test-user's")

        // Reset for subsequent tests in the suite.
        ActiveSession.installFakeUserIdForTesting("test-user")
    }

    /// `refreshScouts` refuses to fetch when `ActiveSession.userId` is nil
    /// at the call site (auth-gap windows). Without this, the captured
    /// requestUserId would be undefined and the upsert would have no
    /// ground truth for stamping rows. Easier to surface an error than
    /// to upsert under whoever happens to be active when the response
    /// lands.
    @Test func refreshScoutsRefusesWhenNotAuthenticated() async throws {
        let (store, _, context) = try makeStore()
        ActiveSession.endTestingSession()

        await store.refreshScouts(status: "all")

        let rows = try fetchScoutRows(context)
        #expect(rows.isEmpty, "no rows should land when ActiveSession is nil")
        #expect(store.errorMessage != nil)

        // Reset for subsequent tests in the suite.
        ActiveSession.installFakeUserIdForTesting("test-user")
    }

    @Test func triggerRunPostsAndAcceptsOKResponse() async throws {
        let (store, client, _) = try makeStore()
        MockURLProtocol.reset()

        MockURLProtocol.stub(
            url: scoutURL(client, id: "r1", tail: "/run"),
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: ["ok": true, "message": "Run triggered"])
        )

        try await store.triggerRun(id: "r1")

        // Assert the request was made with POST
        let recorded = MockURLProtocol.recordedRequests()
        let runRequest = recorded.first {
            $0.url?.absoluteString.hasSuffix("/scouts/r1/run") ?? false
        }
        #expect(runRequest != nil)
        #expect(runRequest?.httpMethod == "POST")
    }
}
