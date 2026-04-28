import Testing
import Foundation
import SwiftData
@testable import Brett

/// Exercises `ScoutStore` against a stubbed `APIClient`.
///
/// Tests cover:
/// - fetching the roster populates `scouts` and surfaces errors
/// - pause / resume / delete update the roster atomically
/// - `submitFeedback` round-trips and decodes the response
/// - `triggerRun` POSTs to `/scouts/:id/run` and tolerates a bare `ok:true` body
///
/// We build a dedicated `APIClient` per test using `MockURLProtocol` so
/// stubs never leak between cases.
@Suite("ScoutStore", .tags(.views), .serialized)
@MainActor
struct ScoutStoreTests {
    /// Reset MockURLProtocol before each test. See AttachmentUploaderTests.
    init() { MockURLProtocol.reset() }

    // MARK: - Fixtures

    private func makeStore() -> (ScoutStore, APIClient) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let client = APIClient(session: URLSession(configuration: config))
        let store = ScoutStore(client: client, context: nil)
        return (store, client)
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

    private func sampleScoutJSON(
        id: String = "scout-1",
        name: String = "Coffee Deals",
        status: String = "active",
        findings: Int = 3
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
            "createdAt": "2026-04-01T12:00:00.000Z",
        ]
    }

    // MARK: - Roster

    @Test func refreshScoutsPopulatesList() async throws {
        let (store, client) = makeStore()
        MockURLProtocol.reset()

        let body = try JSONSerialization.data(withJSONObject: [
            sampleScoutJSON(id: "a", name: "Alpha", status: "active", findings: 2),
            sampleScoutJSON(id: "b", name: "Beta", status: "paused", findings: 0),
        ])

        // APIClient.rawRequest uses `appendingPathComponent`, which percent-
        // encodes the `?`, so the wire URL is /scouts%3Fstatus=active.
        let url = encodedURL(client, path: "/scouts?status=active")
        MockURLProtocol.stub(url: url, statusCode: 200, body: body)

        await store.refreshScouts(status: "active")

        #expect(store.scouts.count == 2)
        #expect(store.scouts.first?.name == "Alpha")
        #expect(store.errorMessage == nil)
    }

    @Test func refreshScoutsSurfacesServerError() async throws {
        let (store, client) = makeStore()
        MockURLProtocol.reset()

        let url = encodedURL(client, path: "/scouts?status=all")
        MockURLProtocol.stub(url: url, statusCode: 500, body: Data())

        await store.refreshScouts(status: "all")

        #expect(store.scouts.isEmpty)
        #expect(store.errorMessage != nil)
    }

    // MARK: - Mutations

    @Test func pauseReplacesRosterEntry() async throws {
        let (store, client) = makeStore()
        MockURLProtocol.reset()

        // Seed the roster with an active scout.
        let seedUrl = encodedURL(client, path: "/scouts?status=all")
        MockURLProtocol.stub(
            url: seedUrl,
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: [sampleScoutJSON(id: "p1", status: "active")])
        )
        await store.refreshScouts(status: "all")
        #expect(store.scouts.first?.status == "active")

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

        #expect(store.scouts.first?.status == "paused")
    }

    @Test func deleteRemovesFromRoster() async throws {
        let (store, client) = makeStore()
        MockURLProtocol.reset()

        let seedUrl = encodedURL(client, path: "/scouts?status=all")
        MockURLProtocol.stub(
            url: seedUrl,
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: [sampleScoutJSON(id: "d1")])
        )
        await store.refreshScouts(status: "all")
        #expect(store.scouts.count == 1)

        MockURLProtocol.stub(
            url: scoutURL(client, id: "d1"),
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: ["ok": true])
        )

        try await store.delete(id: "d1")

        #expect(store.scouts.isEmpty)
    }

    // MARK: - Feedback

    @Test func submitFeedbackDecodesResponse() async throws {
        let (store, client) = makeStore()
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
        let (store, client) = makeStore()
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

    @Test func triggerRunPostsAndAcceptsOKResponse() async throws {
        let (store, client) = makeStore()
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
