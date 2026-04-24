import Testing
import Foundation
import SwiftData
@testable import Brett

/// End-to-end sync flows that thread PushEngine + PullEngine + MutationQueue
/// together in realistic scenarios. Each test uses an in-memory SwiftData
/// container and a `MockURLProtocol`-backed `APIClient`, so no network / disk
/// touches outside the test sandbox.
///
/// These cover interactions that the per-engine tests can't exercise on their
/// own:
///  - Local create → push → server-canonical record upserted back
///  - Pull overwrites local, then a push on a stale field triggers conflict
///  - Delete-while-offline → push returns `not_found` → mutation cleared
///  - Dependency chain: list CREATE pushed before Item that references it
@Suite("IntegrationFlow", .tags(.sync), .serialized)
@MainActor
struct IntegrationFlowTests {
    /// Reset MockURLProtocol before each test. See AttachmentUploaderTests.
    init() { MockURLProtocol.reset() }

    // MARK: - Harness

    /// One-shot harness that wires a push engine against an in-memory context
    /// and MockURLProtocol, plus a real `MutationQueue` (not a fake) so the
    /// queue's compaction + dependency ordering is part of the integration.
    @MainActor
    final class Harness {
        let context: ModelContext
        let queue: MutationQueue
        let apiClient: APIClient
        let pushEngine: PushEngine
        let pullEngine: PullEngine

        init() throws {
            let container = try InMemoryPersistenceController.makeContainer()
            let ctx = ModelContext(container)
            self.context = ctx
            self.queue = MutationQueue(context: ctx)

            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [MockURLProtocol.self]
            let session = URLSession(configuration: config)
            let client = APIClient(session: session)
            client.tokenProvider = { "test-token" }
            self.apiClient = client

            self.pushEngine = PushEngine(
                mutationQueue: queue,
                apiClient: client,
                context: ctx
            )
            self.pullEngine = PullEngine(
                apiClient: client,
                context: ctx
            )
        }

        var pushURL: URL { apiClient.baseURL.appendingPathComponent("sync/push") }
        var pullURL: URL { apiClient.baseURL.appendingPathComponent("sync/pull") }

        /// Stub `/sync/push` with a pre-built response body.
        func stubPush(_ body: [String: Any], statusCode: Int = 200) throws {
            MockURLProtocol.stub(
                url: pushURL,
                statusCode: statusCode,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        }

        /// Stub `/sync/pull` with a pre-built response body.
        func stubPull(_ body: [String: Any], statusCode: Int = 200) throws {
            MockURLProtocol.stub(
                url: pullURL,
                statusCode: statusCode,
                body: try JSONSerialization.data(withJSONObject: body)
            )
        }

        /// Build an empty-but-valid `/sync/pull` response body.
        func emptyPullBody() -> [String: Any] {
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

        /// Enqueue a CREATE mutation the way ItemStore would. Returns the
        /// mutation's idempotency key so tests can stub the server response
        /// to match.
        @discardableResult
        func enqueueItemCreate(
            id: String,
            title: String,
            listId: String? = nil
        ) -> MutationQueueEntry {
            // Seed the local Item mirror so the push engine has something to
            // upsert server data into.
            let item = Item(
                id: id,
                userId: "user-1",
                title: title,
                listId: listId
            )
            item._syncStatus = SyncStatus.pendingCreate.rawValue
            context.insert(item)

            var payload: [String: Any] = [
                "id": id,
                "type": "task",
                "status": "active",
                "title": title,
                "userId": "user-1",
                "source": "Brett",
            ]
            if let listId { payload["listId"] = listId }
            let payloadString = String(
                data: try! JSONSerialization.data(withJSONObject: payload),
                encoding: .utf8
            ) ?? "{}"

            return queue.enqueue(
                entityType: "item",
                entityId: id,
                action: .create,
                endpoint: "/things",
                method: .post,
                payload: payloadString
            )!
        }
    }

    // MARK: - Create → Push → Server record applied

    @Test func createThenPushUpsertsServerRecordAndClearsMutation() async throws {
        MockURLProtocol.reset()
        let h = try Harness()

        let created = h.enqueueItemCreate(id: "item-new", title: "Local optimistic")

        // Server echoes a canonical record back.
        let responseBody: [String: Any] = [
            "results": [
                [
                    "idempotencyKey": created.idempotencyKey,
                    "status": "applied",
                    "record": [
                        "id": "item-new",
                        "userId": "user-1",
                        "type": "task",
                        "status": "active",
                        "title": "Server canonical",
                        "source": "Brett",
                        "createdAt": "2026-04-14T00:00:00.000Z",
                        "updatedAt": "2026-04-14T12:00:00.000Z",
                    ],
                ]
            ],
            "serverTime": "2026-04-14T12:00:00.000Z",
        ]
        try h.stubPush(responseBody)

        let outcome = try await h.pushEngine.push()
        #expect(outcome.applied == 1)
        #expect(outcome.remaining == 0)

        // Local mirror should now carry the server's canonical title and
        // synced status.
        let items: [Item] = try h.context.fetch(FetchDescriptor<Item>())
        #expect(items.count == 1)
        #expect(items.first?.title == "Server canonical")
        #expect(items.first?._syncStatus == SyncStatus.synced.rawValue)

        // Mutation queue should be drained — the entry completed.
        #expect(h.queue.pendingEntries().isEmpty)
        #expect(h.queue.getByIdempotencyKey(created.idempotencyKey) == nil)
    }

    // MARK: - Pull overwrite then push conflict

    @Test func pullOverwritesLocalThenPushSurfacesConflict() async throws {
        MockURLProtocol.reset()
        let h = try Harness()

        // 1. Seed a local Item in sync with the server.
        let item = Item(id: "item-conflict", userId: "user-1", title: "Original")
        item._syncStatus = SyncStatus.synced.rawValue
        item._baseUpdatedAt = "2026-04-14T10:00:00.000Z"
        h.context.insert(item)
        try h.context.save()

        // 2. Pull brings a newer server version.
        var pullBody = h.emptyPullBody()
        var changes = pullBody["changes"] as! [String: Any]
        changes["items"] = [
            "upserted": [[
                "id": "item-conflict",
                "userId": "user-1",
                "type": "task",
                "status": "active",
                "title": "Server edited",
                "source": "Brett",
                "createdAt": "2026-04-14T00:00:00.000Z",
                "updatedAt": "2026-04-14T11:00:00.000Z",
            ]],
            "deleted": [],
            "hasMore": false,
        ]
        pullBody["changes"] = changes
        pullBody["cursors"] = ["items": "2026-04-14T11:00:00.000Z"]
        try h.stubPull(pullBody)

        _ = try await h.pullEngine.pull()

        // After the pull, the local record reflects the server's new title.
        let afterPull: [Item] = try h.context.fetch(FetchDescriptor<Item>())
        #expect(afterPull.first?.title == "Server edited")

        // 3. Now the user edits the same record — but quotes a stale
        //    `previousValues` that matches what they saw, NOT what the
        //    server currently has. This simulates an offline edit.
        let updatePayload: [String: Any] = ["title": "Local wins?"]
        let updateEntry = MutationQueueEntry(
            entityType: "item",
            entityId: "item-conflict",
            action: .update,
            endpoint: "/things/item-conflict",
            method: .patch,
            payload: String(data: try JSONSerialization.data(withJSONObject: updatePayload), encoding: .utf8)!,
            changedFields: "[\"title\"]",
            previousValues: "{\"title\":\"Original\"}",
            baseUpdatedAt: "2026-04-14T10:00:00.000Z"
        )
        h.context.insert(updateEntry)
        try h.context.save()

        // Now mutate the local item to reflect the user's optimistic edit
        // (this is what ItemStore.update would do) but mark _syncStatus as
        // pendingUpdate so PushEngine.markLocalConflict can flip it.
        let local = try h.context.fetch(FetchDescriptor<Item>()).first!
        local.title = "Local wins?"
        local._syncStatus = SyncStatus.pendingUpdate.rawValue
        try h.context.save()

        // 4. Server rejects the update as a concurrent-edit conflict.
        let pushBody: [String: Any] = [
            "results": [
                [
                    "idempotencyKey": updateEntry.idempotencyKey,
                    "status": "conflict",
                    "conflictedFields": ["title"],
                    "record": [
                        "id": "item-conflict",
                        "userId": "user-1",
                        "type": "task",
                        "status": "active",
                        "title": "Server edited",
                        "source": "Brett",
                        "createdAt": "2026-04-14T00:00:00.000Z",
                        "updatedAt": "2026-04-14T11:00:00.000Z",
                    ],
                    "error": "concurrent edit",
                ]
            ],
            "serverTime": "2026-04-14T11:30:00.000Z",
        ]
        try h.stubPush(pushBody)

        let outcome = try await h.pushEngine.push()
        #expect(outcome.conflicts == 1)

        // Assert the local record is now in conflict state, and a log row was
        // written.
        let finalItem = try h.context.fetch(FetchDescriptor<Item>()).first!
        #expect(finalItem._syncStatus == SyncStatus.conflict.rawValue)

        let logs: [ConflictLogEntry] = try h.context.fetch(FetchDescriptor<ConflictLogEntry>())
        #expect(logs.count == 1)
        #expect(logs.first?.resolution == "server_wins")
        #expect(logs.first?.entityId == "item-conflict")
    }

    // MARK: - Delete-then-offline → push returns not_found

    @Test func deleteOfAlreadyGoneItemCompletesCleanly() async throws {
        MockURLProtocol.reset()
        let h = try Harness()

        // 1. Seed a local item + a DELETE mutation (the delete queued while
        //    the app was offline).
        let item = Item(id: "item-gone", userId: "user-1", title: "Doomed")
        item._syncStatus = SyncStatus.pendingDelete.rawValue
        item.deletedAt = Date()
        h.context.insert(item)

        let deleteMutation = MutationQueueEntry(
            entityType: "item",
            entityId: "item-gone",
            action: .delete,
            endpoint: "/things/item-gone",
            method: .delete,
            payload: "{}"
        )
        h.context.insert(deleteMutation)
        try h.context.save()

        // 2. Server already reaped the row — responds not_found.
        let body: [String: Any] = [
            "results": [
                [
                    "idempotencyKey": deleteMutation.idempotencyKey,
                    "status": "not_found",
                ]
            ],
            "serverTime": "2026-04-14T11:00:00.000Z",
        ]
        try h.stubPush(body)

        let outcome = try await h.pushEngine.push()
        #expect(outcome.applied == 1, "not_found completes the mutation silently")
        #expect(h.queue.pendingEntries().isEmpty)
    }

    // MARK: - Dependency chain — list then item

    @Test func listCreateFollowedByItemCreatePushesInOrder() async throws {
        MockURLProtocol.reset()
        let h = try Harness()

        // Enqueue list CREATE first, then an item CREATE that depends on it.
        let list = ItemList(id: "list-local", userId: "user-1", name: "New List")
        list._syncStatus = SyncStatus.pendingCreate.rawValue
        h.context.insert(list)

        let listPayload: [String: Any] = [
            "id": "list-local",
            "name": "New List",
            "colorClass": "bg-blue-500",
            "sortOrder": 0,
            "userId": "user-1",
        ]
        let listEntry = h.queue.enqueue(
            entityType: "list",
            entityId: "list-local",
            action: .create,
            endpoint: "/lists",
            method: .post,
            payload: String(data: try JSONSerialization.data(withJSONObject: listPayload), encoding: .utf8)!,
            now: Date(timeIntervalSince1970: 100)
        )!

        // Item that references the list, with an explicit dependency edge.
        let item = Item(
            id: "item-child",
            userId: "user-1",
            title: "Child of new list",
            listId: "list-local"
        )
        item._syncStatus = SyncStatus.pendingCreate.rawValue
        h.context.insert(item)

        let itemPayload: [String: Any] = [
            "id": "item-child",
            "type": "task",
            "status": "active",
            "title": "Child of new list",
            "listId": "list-local",
            "userId": "user-1",
            "source": "Brett",
        ]
        _ = h.queue.enqueue(
            entityType: "item",
            entityId: "item-child",
            action: .create,
            endpoint: "/things",
            method: .post,
            payload: String(data: try JSONSerialization.data(withJSONObject: itemPayload), encoding: .utf8)!,
            dependsOn: listEntry.id,
            now: Date(timeIntervalSince1970: 101)
        )

        try h.context.save()

        // Verify the queue orders parent before child with limit=1.
        let firstBatch = h.queue.pendingEntries(limit: 1)
        #expect(firstBatch.count == 1)
        #expect(firstBatch.first?.entityType == "list",
                "parent mutation must push before child")

        // Full batch returns both, parent first.
        let fullBatch = h.queue.pendingEntries()
        #expect(fullBatch.count == 2)
        #expect(fullBatch.first?.entityType == "list")
        #expect(fullBatch.last?.entityType == "item")

        // Now simulate a successful push where the server applies both in
        // order. MockURLProtocol can only hold one response per URL, so we
        // stub a single combined response — that's what the real server
        // would send back when both mutations arrive in the same batch.
        let combinedBody: [String: Any] = [
            "results": [
                [
                    "idempotencyKey": listEntry.idempotencyKey,
                    "status": "applied",
                    "record": [
                        "id": "list-local",
                        "userId": "user-1",
                        "name": "New List",
                        "colorClass": "bg-blue-500",
                        "sortOrder": 0,
                        "createdAt": "2026-04-14T00:00:00.000Z",
                        "updatedAt": "2026-04-14T12:00:00.000Z",
                    ],
                ],
                [
                    "idempotencyKey": fullBatch.last!.idempotencyKey,
                    "status": "applied",
                    "record": [
                        "id": "item-child",
                        "userId": "user-1",
                        "type": "task",
                        "status": "active",
                        "title": "Child of new list",
                        "listId": "list-local",
                        "source": "Brett",
                        "createdAt": "2026-04-14T00:00:00.000Z",
                        "updatedAt": "2026-04-14T12:00:00.000Z",
                    ],
                ],
            ],
            "serverTime": "2026-04-14T12:00:00.000Z",
        ]
        try h.stubPush(combinedBody)

        let outcome = try await h.pushEngine.push()
        #expect(outcome.applied == 2)
        #expect(h.queue.pendingEntries().isEmpty)

        // Both local records are now synced.
        let lists: [ItemList] = try h.context.fetch(FetchDescriptor<ItemList>())
        let items: [Item] = try h.context.fetch(FetchDescriptor<Item>())
        #expect(lists.first?._syncStatus == SyncStatus.synced.rawValue)
        #expect(items.first?._syncStatus == SyncStatus.synced.rawValue)
        #expect(items.first?.listId == "list-local")
    }
}
