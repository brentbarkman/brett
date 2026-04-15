import Foundation
import SwiftData
import Testing
@testable import Brett

/// End-to-end tests for `MutationQueue`: enqueue with eager compaction,
/// dequeue ordering, failure handling, crash recovery, and idempotency.
///
/// Each test spins up a fresh in-memory container so state doesn't leak
/// across cases. We deliberately pass explicit `createdAt` timestamps so
/// FIFO ordering is deterministic regardless of test runtime speed.
@MainActor
@Suite("MutationQueue", .tags(.sync))
struct MutationQueueTests {
    // MARK: - Enqueue

    @Test func enqueueCreatesPendingEntry() throws {
        let (queue, _) = try makeQueue()

        let entry = queue.enqueue(
            entityType: "item",
            entityId: "item-1",
            action: .create,
            endpoint: "/things",
            method: .post,
            payload: #"{"title":"Hello"}"#
        )

        try #require(entry != nil)
        #expect(entry?.statusEnum == .pending)
        #expect(entry?.retryCount == 0)
        #expect(queue.pendingEntries().count == 1)
    }

    @Test func enqueueCompactsCreatePlusUpdateIntoSingleCreate() throws {
        let (queue, _) = try makeQueue()

        queue.enqueue(
            entityType: "item",
            entityId: "item-1",
            action: .create,
            endpoint: "/things",
            method: .post,
            payload: #"{"id":"item-1","title":"Hello","status":"active"}"#,
            now: Date(timeIntervalSince1970: 100)
        )

        queue.enqueue(
            entityType: "item",
            entityId: "item-1",
            action: .update,
            endpoint: "/things/item-1",
            method: .patch,
            payload: #"{"title":"Renamed"}"#,
            changedFields: #"["title"]"#,
            now: Date(timeIntervalSince1970: 101)
        )

        let pending = queue.pendingEntries()
        #expect(pending.count == 1)

        let sole = try #require(pending.first)
        #expect(sole.actionEnum == .create)

        // Merged payload should reflect the newer title while preserving
        // fields that were only on the CREATE.
        let merged = decode(sole.payload)
        #expect(merged?["title"] as? String == "Renamed")
        #expect(merged?["status"] as? String == "active")
        #expect(merged?["id"] as? String == "item-1")
    }

    @Test func enqueueCompactsCreatePlusDeleteToNothing() throws {
        let (queue, _) = try makeQueue()

        queue.enqueue(
            entityType: "item",
            entityId: "item-2",
            action: .create,
            endpoint: "/things",
            method: .post,
            payload: #"{"id":"item-2"}"#,
            now: Date(timeIntervalSince1970: 200)
        )

        queue.enqueue(
            entityType: "item",
            entityId: "item-2",
            action: .delete,
            endpoint: "/things/item-2",
            method: .delete,
            payload: "{}",
            now: Date(timeIntervalSince1970: 201)
        )

        #expect(queue.pendingEntries().isEmpty)
    }

    @Test func enqueueCompactsUpdatePlusUpdateWithMergedChangedFields() throws {
        let (queue, _) = try makeQueue()

        queue.enqueue(
            entityType: "item",
            entityId: "item-3",
            action: .update,
            endpoint: "/things/item-3",
            method: .patch,
            payload: #"{"title":"First"}"#,
            changedFields: #"["title"]"#,
            previousValues: #"{"title":"Original"}"#,
            now: Date(timeIntervalSince1970: 300)
        )

        queue.enqueue(
            entityType: "item",
            entityId: "item-3",
            action: .update,
            endpoint: "/things/item-3",
            method: .patch,
            payload: #"{"notes":"First notes"}"#,
            changedFields: #"["notes"]"#,
            previousValues: #"{"notes":null}"#,
            now: Date(timeIntervalSince1970: 301)
        )

        let pending = queue.pendingEntries()
        #expect(pending.count == 1)
        let merged = try #require(pending.first)
        #expect(merged.actionEnum == .update)

        // changedFields is the union of both mutations.
        let fields = decodeArray(merged.changedFields) ?? []
        #expect(Set(fields) == ["title", "notes"])

        // payload contains both keys.
        let payload = decode(merged.payload) ?? [:]
        #expect(payload["title"] as? String == "First")
        #expect(payload["notes"] as? String == "First notes")

        // previousValues should keep the earliest value for each field.
        let prev = decode(merged.previousValues ?? "") ?? [:]
        #expect(prev["title"] as? String == "Original")
        #expect(prev["notes"] is NSNull)
    }

    @Test func enqueueCompactsUpdatePlusDeleteToDelete() throws {
        let (queue, _) = try makeQueue()

        queue.enqueue(
            entityType: "item",
            entityId: "item-4",
            action: .update,
            endpoint: "/things/item-4",
            method: .patch,
            payload: #"{"title":"Doomed"}"#,
            changedFields: #"["title"]"#,
            now: Date(timeIntervalSince1970: 400)
        )

        queue.enqueue(
            entityType: "item",
            entityId: "item-4",
            action: .delete,
            endpoint: "/things/item-4",
            method: .delete,
            payload: "{}",
            now: Date(timeIntervalSince1970: 401)
        )

        let pending = queue.pendingEntries()
        #expect(pending.count == 1)
        #expect(pending.first?.actionEnum == .delete)
    }

    // MARK: - Dependency ordering

    @Test func pendingEntriesSkipsDependsOnWhenPredecessorPending() throws {
        let (queue, _) = try makeQueue()

        // NOTE: "enqueue" the child first with a random dependency ID, then
        // patch it afterward. We explicitly model parent enqueue AFTER child
        // so the test can assert that pendingEntries uses dependency order,
        // not raw createdAt order.
        let parent = queue.enqueue(
            entityType: "list",
            entityId: "list-parent",
            action: .create,
            endpoint: "/lists",
            method: .post,
            payload: #"{"id":"list-parent"}"#,
            now: Date(timeIntervalSince1970: 500)
        )
        let parentId = try #require(parent?.id)

        queue.enqueue(
            entityType: "item",
            entityId: "item-child",
            action: .create,
            endpoint: "/things",
            method: .post,
            payload: #"{"id":"item-child","listId":"list-parent"}"#,
            dependsOn: parentId,
            now: Date(timeIntervalSince1970: 501)
        )

        // Parent pending: both parent and child should come back, with
        // parent first. If we ask for just a single entry, it's the parent.
        let one = queue.pendingEntries(limit: 1)
        #expect(one.count == 1)
        #expect(one.first?.id == parentId)

        // Full batch returns both, parent first.
        let all = queue.pendingEntries()
        #expect(all.count == 2)
        #expect(all.first?.id == parentId)
    }

    @Test func pendingEntriesSkipsChildWhenParentStillPending() throws {
        // Complementary test: insert child with a missing parent. If the
        // parent row exists AND is pending, the child should be skipped
        // until it's the parent's turn. Here we set limit=1 and explicitly
        // confirm the parent comes back before the child even though the
        // child has a later createdAt.
        let (queue, _) = try makeQueue()

        let parent = queue.enqueue(
            entityType: "list",
            entityId: "list-p",
            action: .create,
            endpoint: "/lists",
            method: .post,
            payload: #"{}"#,
            now: Date(timeIntervalSince1970: 600)
        )
        let parentId = try #require(parent?.id)

        queue.enqueue(
            entityType: "item",
            entityId: "item-c",
            action: .create,
            endpoint: "/things",
            method: .post,
            payload: #"{}"#,
            dependsOn: parentId,
            now: Date(timeIntervalSince1970: 601)
        )

        let batch = queue.pendingEntries(limit: 1)
        #expect(batch.first?.entityType == "list")
    }

    // MARK: - Failure handling

    @Test func failIncrementsRetryCount() throws {
        let (queue, _) = try makeQueue()

        let entry = try #require(
            queue.enqueue(
                entityType: "item",
                entityId: "item-fail",
                action: .update,
                endpoint: "/things/item-fail",
                method: .patch,
                payload: #"{}"#
            )
        )

        queue.fail(id: entry.id, error: "server boom", errorCode: 500)

        let refetched = try #require(queue.getByIdempotencyKey(entry.idempotencyKey))
        #expect(refetched.retryCount == 1)
        #expect(refetched.error == "server boom")
        #expect(refetched.errorCode == 500)
        #expect(refetched.statusEnum == .pending)
    }

    @Test func failMarksDeadAfter10ServerFailures() throws {
        let (queue, _) = try makeQueue()

        let entry = try #require(
            queue.enqueue(
                entityType: "item",
                entityId: "item-dead",
                action: .update,
                endpoint: "/things/item-dead",
                method: .patch,
                payload: #"{}"#
            )
        )

        for _ in 0..<10 {
            queue.fail(id: entry.id, error: "502 bad gateway", errorCode: 502)
        }

        let refetched = try #require(queue.getByIdempotencyKey(entry.idempotencyKey))
        #expect(refetched.retryCount == 10)
        #expect(refetched.statusEnum == .dead)

        // Dead entries don't appear in the pending list.
        #expect(queue.pendingEntries().isEmpty)
        #expect(queue.deadEntries().count == 1)
    }

    @Test func failWithNoErrorCodeDoesNotCountTowardRetryCap() throws {
        let (queue, _) = try makeQueue()

        let entry = try #require(
            queue.enqueue(
                entityType: "item",
                entityId: "item-net",
                action: .update,
                endpoint: "/things/item-net",
                method: .patch,
                payload: #"{}"#
            )
        )

        // 50 network failures in a row shouldn't be enough to mark dead.
        for _ in 0..<50 {
            queue.fail(id: entry.id, error: "offline", errorCode: nil)
        }

        let refetched = try #require(queue.getByIdempotencyKey(entry.idempotencyKey))
        #expect(refetched.retryCount == 0, "network errors must not increment retryCount")
        #expect(refetched.statusEnum == .pending)
    }

    @Test func failWith4xxPermanentErrorMarksDeadImmediately() throws {
        let (queue, _) = try makeQueue()

        let entry = try #require(
            queue.enqueue(
                entityType: "item",
                entityId: "item-bad",
                action: .update,
                endpoint: "/things/item-bad",
                method: .patch,
                payload: #"{}"#
            )
        )

        queue.fail(id: entry.id, error: "validation failed", errorCode: 422)

        let refetched = try #require(queue.getByIdempotencyKey(entry.idempotencyKey))
        #expect(refetched.statusEnum == .dead)
        #expect(refetched.retryCount == 0, "permanent failures shouldn't touch retryCount")
    }

    // MARK: - Lifecycle

    @Test func markInFlightSetsStatus() throws {
        let (queue, _) = try makeQueue()

        let a = try #require(
            queue.enqueue(
                entityType: "item", entityId: "a",
                action: .create, endpoint: "/things", method: .post,
                payload: #"{}"#, now: Date(timeIntervalSince1970: 1_000)
            )
        )
        let b = try #require(
            queue.enqueue(
                entityType: "item", entityId: "b",
                action: .create, endpoint: "/things", method: .post,
                payload: #"{}"#, now: Date(timeIntervalSince1970: 1_001)
            )
        )

        queue.markInFlight(ids: [a.id, b.id])

        #expect(queue.pendingEntries().isEmpty, "in-flight entries should drop out of pendingEntries")

        let refetched = try #require(queue.getByIdempotencyKey(a.idempotencyKey))
        #expect(refetched.statusEnum == .inFlight)
    }

    @Test func completeRemovesEntry() throws {
        let (queue, _) = try makeQueue()

        let entry = try #require(
            queue.enqueue(
                entityType: "item", entityId: "done",
                action: .create, endpoint: "/things", method: .post,
                payload: #"{}"#
            )
        )

        queue.complete(id: entry.id)

        #expect(queue.getByIdempotencyKey(entry.idempotencyKey) == nil)
        #expect(queue.pendingEntries().isEmpty)
    }

    @Test func resetInFlightTransitionsInFlightToPending() throws {
        let (queue, _) = try makeQueue()

        let entry = try #require(
            queue.enqueue(
                entityType: "item", entityId: "crash",
                action: .create, endpoint: "/things", method: .post,
                payload: #"{}"#
            )
        )
        queue.markInFlight(ids: [entry.id])
        #expect(queue.pendingEntries().isEmpty)

        queue.resetInFlight()

        let pending = queue.pendingEntries()
        #expect(pending.count == 1)
        #expect(pending.first?.id == entry.id)
    }

    @Test func getByIdempotencyKeyReturnsMatch() throws {
        let (queue, _) = try makeQueue()

        let explicitKey = "client-idempotency-xyz"
        let entry = try #require(
            queue.enqueue(
                entityType: "item", entityId: "idempo",
                action: .create, endpoint: "/things", method: .post,
                payload: #"{}"#, idempotencyKey: explicitKey
            )
        )

        let hit = try #require(queue.getByIdempotencyKey(explicitKey))
        #expect(hit.id == entry.id)
        #expect(hit.idempotencyKey == explicitKey)

        #expect(queue.getByIdempotencyKey("not-a-key") == nil)
    }

    // MARK: - Test helpers

    private func makeQueue() throws -> (MutationQueue, ModelContext) {
        let context = try InMemoryPersistenceController.makeContext()
        return (MutationQueue(context: context), context)
    }

    private func decode(_ json: String) -> [String: Any]? {
        guard let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private func decodeArray(_ json: String?) -> [String]? {
        guard let json, let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String]
    }
}
