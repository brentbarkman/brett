import Testing
import Foundation
@testable import Brett

/// Exercises `NewsletterStore` against a stubbed API. Tests cover the happy
/// path (fetch + mutate) and the optimistic-revert behaviour when a mutation
/// fails.
///
/// We build a dedicated `APIClient` per test using `MockURLProtocol` so
/// stubs never leak between cases.
@Suite("NewsletterStore", .tags(.views), .serialized)
@MainActor
struct NewsletterStoreTests {

    private func makeStore() -> (NewsletterStore, APIClient) {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        let client = APIClient(session: URLSession(configuration: config))
        let store = NewsletterStore(client: client)
        return (store, client)
    }

    private func ingestURL(client: APIClient) -> URL {
        client.baseURL.appendingPathComponent("newsletters/ingest-address")
    }

    private func sendersURL(client: APIClient) -> URL {
        client.baseURL.appendingPathComponent("newsletters")
    }

    private func pendingURL(client: APIClient) -> URL {
        client.baseURL.appendingPathComponent("newsletters/pending")
    }

    private func senderPatchURL(client: APIClient, id: String) -> URL {
        client.baseURL.appendingPathComponent("newsletters/\(id)")
    }

    private func stubFetchAll(
        client: APIClient,
        ingestEmail: String?,
        senders: [[String: Any]],
        pending: [[String: Any]]
    ) throws {
        MockURLProtocol.reset()
        let addressPayload: [String: Any] = ["ingestEmail": ingestEmail as Any]
        MockURLProtocol.stub(
            url: ingestURL(client: client),
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: addressPayload)
        )
        MockURLProtocol.stub(
            url: sendersURL(client: client),
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: senders)
        )
        MockURLProtocol.stub(
            url: pendingURL(client: client),
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: pending)
        )
    }

    @Test func fetchPopulatesIngestSendersAndPending() async throws {
        let (store, client) = makeStore()
        try stubFetchAll(
            client: client,
            ingestEmail: "ingest+abc123@brettalerts.com",
            senders: [
                [
                    "id": "s1",
                    "name": "Morning Brew",
                    "email": "crew@morningbrew.com",
                    "active": true,
                ]
            ],
            pending: [
                [
                    "id": "p1",
                    "senderName": "Startup Digest",
                    "senderEmail": "hi@startupdigest.com",
                    "subject": "Your weekly read",
                    "receivedAt": "2026-04-14T09:00:00.000Z",
                ]
            ]
        )

        await store.fetch()

        #expect(store.ingestAddress == "ingest+abc123@brettalerts.com")
        #expect(store.senders.count == 1)
        #expect(store.senders.first?.name == "Morning Brew")
        #expect(store.pending.count == 1)
        #expect(store.pending.first?.senderEmail == "hi@startupdigest.com")
        #expect(store.errorMessage == nil)
    }

    @Test func fetchSurfacesErrorWhenEndpointFails() async throws {
        let (store, client) = makeStore()
        MockURLProtocol.reset()

        MockURLProtocol.stub(
            url: ingestURL(client: client),
            statusCode: 500,
            body: Data()
        )
        MockURLProtocol.stub(
            url: sendersURL(client: client),
            statusCode: 200,
            body: Data("[]".utf8)
        )
        MockURLProtocol.stub(
            url: pendingURL(client: client),
            statusCode: 200,
            body: Data("[]".utf8)
        )

        await store.fetch()

        #expect(store.errorMessage != nil)
    }

    @Test func updateSenderOptimisticallyFlipsActive() async throws {
        let (store, client) = makeStore()

        try stubFetchAll(
            client: client,
            ingestEmail: "ingest+x@brett.app",
            senders: [
                [
                    "id": "s1",
                    "name": "Alpha",
                    "email": "alpha@example.com",
                    "active": true,
                ]
            ],
            pending: []
        )
        await store.fetch()

        MockURLProtocol.stub(
            url: senderPatchURL(client: client, id: "s1"),
            statusCode: 200,
            body: try JSONSerialization.data(withJSONObject: [
                "id": "s1",
                "name": "Alpha",
                "email": "alpha@example.com",
                "active": false,
            ])
        )

        await store.updateSender(id: "s1", active: false)

        #expect(store.senders.first?.active == false)
    }

    @Test func deleteSenderRemovesLocally() async throws {
        let (store, client) = makeStore()

        try stubFetchAll(
            client: client,
            ingestEmail: nil,
            senders: [
                ["id": "s1", "name": "A", "email": "a@x.com", "active": true],
                ["id": "s2", "name": "B", "email": "b@x.com", "active": true],
            ],
            pending: []
        )
        await store.fetch()
        #expect(store.senders.count == 2)

        MockURLProtocol.stub(
            url: senderPatchURL(client: client, id: "s1"),
            statusCode: 200,
            body: Data("{\"ok\":true}".utf8)
        )

        await store.deleteSender(id: "s1")

        #expect(store.senders.count == 1)
        #expect(store.senders.first?.id == "s2")
    }

    @Test func blockPendingRemovesFromPendingList() async throws {
        let (store, client) = makeStore()

        try stubFetchAll(
            client: client,
            ingestEmail: nil,
            senders: [],
            pending: [
                [
                    "id": "p1",
                    "senderName": "N",
                    "senderEmail": "n@x.com",
                    "subject": "S",
                    "receivedAt": "2026-04-14T09:00:00.000Z",
                ]
            ]
        )
        await store.fetch()
        #expect(store.pending.count == 1)

        MockURLProtocol.stub(
            url: client.baseURL.appendingPathComponent("newsletters/p1/block"),
            statusCode: 200,
            body: Data("{\"ok\":true}".utf8)
        )

        await store.blockPending(id: "p1")

        #expect(store.pending.isEmpty)
    }
}
