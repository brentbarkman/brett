import Testing
import Foundation
import SwiftData
@testable import Brett

/// Exercises the push engine end-to-end using `MockURLProtocol` for HTTP
/// stubbing and a lightweight `FakeMutationQueue` that records calls so
/// we can assert on queue transitions.
@Suite("PushEngine", .tags(.sync), .serialized)
@MainActor
struct PushEngineTests {
    /// Reset MockURLProtocol before each test. The stub registry + request
    /// log are static; without this reset, a test that asserts the log is
    /// empty sees stragglers from a previous suite.
    init() { MockURLProtocol.reset() }

    // MARK: - Fixtures

    /// Compute the URL the APIClient will POST to, matching the rules in
    /// `APIClient.rawRequest` so stubs match regardless of the `BrettAPIURL`
    /// resolved from the bundle at test time.
    private var pushURL: URL {
        let client = APIClient(session: .shared)
        return client.baseURL.appendingPathComponent("sync/push")
    }

    /// Stand-in for `MutationQueue` that conforms to `MutationQueueProtocol`
    /// so the engine can be driven without a real SwiftData queue.
    @MainActor
    final class FakeMutationQueue: MutationQueueProtocol {
        var pending: [MutationQueueEntry] = []
        var completedIds: [String] = []
        var failedIds: [(id: String, error: String, code: Int?)] = []
        var inFlightCalls: [[String]] = []

        func pendingEntries(limit: Int) -> [MutationQueueEntry] {
            Array(pending.prefix(limit))
        }

        func markInFlight(ids: [String]) {
            inFlightCalls.append(ids)
        }

        func complete(id: String) {
            completedIds.append(id)
            pending.removeAll { $0.id == id }
        }

        func fail(id: String, error: String, errorCode: Int?) {
            failedIds.append((id, error, errorCode))
        }

        func getByIdempotencyKey(_ key: String) -> MutationQueueEntry? {
            pending.first(where: { $0.idempotencyKey == key })
        }

        func pendingCount() -> Int {
            pending.count
        }
    }

    /// Build an APIClient backed by `MockURLProtocol`. Does NOT reset the
    /// stub registry — callers register their stub, then construct the
    /// client, then fire the request.
    private func makeStubbedClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return APIClient(session: URLSession(configuration: config))
    }

    /// Clear any existing stubs and register a fresh `/sync/push` stub.
    private func stubPush(statusCode: Int = 200, body: [String: Any]) throws {
        MockURLProtocol.reset()
        MockURLProtocol.stub(
            url: pushURL,
            statusCode: statusCode,
            body: try JSONSerialization.data(withJSONObject: body)
        )
    }

    private func seedContext() throws -> ModelContext {
        try InMemoryPersistenceController.makeContext()
    }

    private func makePendingUpdate(
        entityId: String = "item-1",
        idempotencyKey: String? = nil
    ) -> MutationQueueEntry {
        let payload: [String: Any] = [
            "title": "Updated title",
        ]
        let payloadJSON = String(
            data: try! JSONSerialization.data(withJSONObject: payload), encoding: .utf8
        ) ?? "{}"
        return MutationQueueEntry(
            idempotencyKey: idempotencyKey,
            entityType: "item",
            entityId: entityId,
            action: .update,
            endpoint: "/things/\(entityId)",
            method: .patch,
            payload: payloadJSON,
            changedFields: "[\"title\"]",
            previousValues: "{\"title\":\"Old title\"}",
            baseUpdatedAt: "2026-04-13T00:00:00.000Z"
        )
    }

    // MARK: - Result handling

    @Test func appliedResultCompletesMutationAndUpsertsRecord() async throws {
        let context = try seedContext()

        // Seed local Item in some stale state — server should overwrite it.
        let item = Item(id: "item-1", userId: "user-1", title: "Local optimistic value")
        item._syncStatus = SyncStatus.pendingUpdate.rawValue
        context.insert(item)
        try context.save()

        let queue = FakeMutationQueue()
        let mutation = makePendingUpdate()
        queue.pending = [mutation]

        // Server returns the authoritative record.
        let body: [String: Any] = [
            "results": [
                [
                    "idempotencyKey": mutation.idempotencyKey,
                    "status": "applied",
                    "record": [
                        "id": "item-1",
                        "userId": "user-1",
                        "type": "task",
                        "status": "active",
                        "title": "Server-canonical title",
                        "source": "Brett",
                        "createdAt": "2026-04-14T00:00:00.000Z",
                        "updatedAt": "2026-04-14T11:00:00.000Z",
                    ],
                ]
            ],
            "serverTime": "2026-04-14T11:00:00.000Z",
        ]
        try stubPush(body: body)

        let client = makeStubbedClient()
        let engine = PushEngine(mutationQueue: queue, apiClient: client, context: context)
        let outcome = try await engine.push()

        #expect(outcome.applied == 1)
        #expect(outcome.merged == 0)
        #expect(outcome.conflicts == 0)
        #expect(outcome.errors == 0)
        #expect(queue.completedIds == [mutation.id])
        #expect(queue.failedIds.isEmpty)

        // Local record should match the server state.
        let items: [Item] = (try? context.fetch(FetchDescriptor<Item>())) ?? []
        #expect(items.first?.title == "Server-canonical title")
        #expect(items.first?._syncStatus == SyncStatus.synced.rawValue)
    }

    @Test func mergedResultUpsertsAndLogsConflict() async throws {
        let context = try seedContext()

        let item = Item(id: "item-1", userId: "user-1", title: "Local title")
        item._syncStatus = SyncStatus.pendingUpdate.rawValue
        context.insert(item)
        try context.save()

        let queue = FakeMutationQueue()
        let mutation = makePendingUpdate()
        queue.pending = [mutation]

        let body: [String: Any] = [
            "results": [
                [
                    "idempotencyKey": mutation.idempotencyKey,
                    "status": "merged",
                    "conflictedFields": ["title"],
                    "record": [
                        "id": "item-1",
                        "userId": "user-1",
                        "type": "task",
                        "status": "active",
                        "title": "Merged server title",
                        "source": "Brett",
                        "createdAt": "2026-04-14T00:00:00.000Z",
                        "updatedAt": "2026-04-14T11:00:00.000Z",
                    ],
                ]
            ],
            "serverTime": "2026-04-14T11:00:00.000Z",
        ]
        try stubPush(body: body)

        let engine = PushEngine(
            mutationQueue: queue,
            apiClient: makeStubbedClient(),
            context: context
        )
        let outcome = try await engine.push()

        #expect(outcome.merged == 1)
        #expect(outcome.conflicts == 0)
        #expect(queue.completedIds == [mutation.id])

        // A ConflictLogEntry should be inserted with resolution=merged.
        let logs: [ConflictLogEntry] = (try? context.fetch(FetchDescriptor<ConflictLogEntry>())) ?? []
        #expect(logs.count == 1)
        #expect(logs.first?.resolution == "merged")
        #expect(logs.first?.entityType == "item")
    }

    @Test func conflictResultMarksLocalConflictAndFailsMutation() async throws {
        let context = try seedContext()

        let item = Item(id: "item-1", userId: "user-1", title: "Local title")
        item._syncStatus = SyncStatus.pendingUpdate.rawValue
        context.insert(item)
        try context.save()

        let queue = FakeMutationQueue()
        let mutation = makePendingUpdate()
        queue.pending = [mutation]

        let body: [String: Any] = [
            "results": [
                [
                    "idempotencyKey": mutation.idempotencyKey,
                    "status": "conflict",
                    "conflictedFields": ["title"],
                    "record": [
                        "id": "item-1",
                        "userId": "user-1",
                        "type": "task",
                        "status": "active",
                        "title": "Server won",
                        "source": "Brett",
                        "createdAt": "2026-04-14T00:00:00.000Z",
                        "updatedAt": "2026-04-14T11:00:00.000Z",
                    ],
                    "error": "concurrent edit",
                ]
            ],
            "serverTime": "2026-04-14T11:00:00.000Z",
        ]
        try stubPush(body: body)

        let engine = PushEngine(
            mutationQueue: queue,
            apiClient: makeStubbedClient(),
            context: context
        )
        let outcome = try await engine.push()

        #expect(outcome.conflicts == 1)
        #expect(outcome.applied == 0)

        // Local should be flagged as conflict, preserved as-is.
        let items: [Item] = (try? context.fetch(FetchDescriptor<Item>())) ?? []
        #expect(items.first?._syncStatus == SyncStatus.conflict.rawValue)
        #expect(items.first?.title == "Local title")

        // Mutation should be marked failed with 409.
        #expect(queue.failedIds.count == 1)
        #expect(queue.failedIds.first?.code == 409)

        // ConflictLogEntry should record resolution=server_wins.
        let logs: [ConflictLogEntry] = (try? context.fetch(FetchDescriptor<ConflictLogEntry>())) ?? []
        #expect(logs.first?.resolution == "server_wins")
    }

    @Test func notFoundResultCompletesMutationQuietly() async throws {
        let context = try seedContext()
        let queue = FakeMutationQueue()
        let mutation = makePendingUpdate()
        queue.pending = [mutation]

        let body: [String: Any] = [
            "results": [
                [
                    "idempotencyKey": mutation.idempotencyKey,
                    "status": "not_found",
                ]
            ],
            "serverTime": "2026-04-14T11:00:00.000Z",
        ]
        try stubPush(body: body)

        let engine = PushEngine(
            mutationQueue: queue,
            apiClient: makeStubbedClient(),
            context: context
        )
        let outcome = try await engine.push()

        #expect(queue.completedIds == [mutation.id])
        #expect(outcome.applied == 1)
    }

    @Test func errorResultFailsMutation() async throws {
        let context = try seedContext()
        let queue = FakeMutationQueue()
        let mutation = makePendingUpdate()
        queue.pending = [mutation]

        let body: [String: Any] = [
            "results": [
                [
                    "idempotencyKey": mutation.idempotencyKey,
                    "status": "error",
                    "error": "Fields not mutable",
                ]
            ],
            "serverTime": "2026-04-14T11:00:00.000Z",
        ]
        try stubPush(body: body)

        let engine = PushEngine(
            mutationQueue: queue,
            apiClient: makeStubbedClient(),
            context: context
        )
        let outcome = try await engine.push()

        #expect(outcome.errors == 1)
        #expect(queue.failedIds.count == 1)
        // Non-conflict error carries no HTTP code.
        #expect(queue.failedIds.first?.code == nil)
        #expect(queue.completedIds.isEmpty)
    }

    // MARK: - Empty queue

    @Test func emptyQueueMakesNoRequest() async throws {
        MockURLProtocol.reset()
        let context = try seedContext()
        let queue = FakeMutationQueue()
        queue.pending = []

        let engine = PushEngine(
            mutationQueue: queue,
            apiClient: makeStubbedClient(),
            context: context
        )
        let outcome = try await engine.push()

        #expect(outcome == PushEngine.PushOutcome.empty)
        // No HTTP request should have been made.
        #expect(MockURLProtocol.recordedRequests().isEmpty)
    }

    // MARK: - Network error

    @Test func networkErrorResetsMutationsToPendingWithoutRetryBump() async throws {
        let context = try seedContext()
        let queue = FakeMutationQueue()
        let mutation = makePendingUpdate()
        queue.pending = [mutation]

        // Simulate a transport-level failure.
        MockURLProtocol.reset()
        MockURLProtocol.stub(url: pushURL, error: URLError(.notConnectedToInternet))

        let engine = PushEngine(
            mutationQueue: queue,
            apiClient: makeStubbedClient(),
            context: context
        )

        do {
            _ = try await engine.push()
            Issue.record("Expected push to throw on network error")
        } catch {
            // Expected: APIError.offline or similar
        }

        // Mutation should be marked failed with no error code (network = retry).
        #expect(queue.failedIds.count == 1)
        #expect(queue.failedIds.first?.code == nil)
        // complete() must NOT be called.
        #expect(queue.completedIds.isEmpty)
    }
}
