import Foundation
import Testing
@testable import Brett

/// Pure-logic tests for the compactor — no SwiftData involved. Each case
/// constructs `MutationQueueEntry` instances directly (they're @Model, but
/// instantiating them outside a ModelContext is fine as long as we never
/// persist them).
@Suite("MutationCompactor", .tags(.sync))
struct MutationCompactorTests {
    // MARK: - Compaction rules

    @Test func createPlusUpdateMergesIntoCreate() throws {
        let create = makeEntry(
            id: "mut-create",
            action: .create,
            payload: #"{"title":"Original","status":"active"}"#,
            createdAt: 100
        )
        let update = makeEntry(
            id: "mut-update",
            action: .update,
            payload: #"{"title":"Renamed"}"#,
            changedFields: #"["title"]"#,
            createdAt: 101
        )

        let result = MutationCompactor.compact(pending: [create], incoming: update)

        #expect(result.toInsert == nil, "UPDATE after CREATE must not insert a new row")
        #expect(result.toDelete.isEmpty)

        let updated = try #require(result.toUpdate)
        #expect(updated.actionEnum == .create)

        let payload = decode(updated.payload) ?? [:]
        #expect(payload["title"] as? String == "Renamed")
        #expect(payload["status"] as? String == "active", "CREATE keys not touched by the UPDATE must survive")
    }

    @Test func createPlusDeleteIsNetZero() {
        let create = makeEntry(id: "mut-create", action: .create, payload: "{}", createdAt: 100)
        let delete = makeEntry(id: "mut-delete", action: .delete, payload: "{}", createdAt: 101)

        let result = MutationCompactor.compact(pending: [create], incoming: delete)

        #expect(result.toInsert == nil)
        #expect(result.toUpdate == nil)
        #expect(result.toDelete == ["mut-create"])
    }

    @Test func updatePlusUpdateMergesChangedFieldsAndPayload() throws {
        let first = makeEntry(
            id: "u1",
            action: .update,
            payload: #"{"title":"A"}"#,
            changedFields: #"["title"]"#,
            previousValues: #"{"title":"original"}"#,
            createdAt: 100
        )
        let second = makeEntry(
            id: "u2",
            action: .update,
            payload: #"{"notes":"hi","title":"B"}"#,
            changedFields: #"["title","notes"]"#,
            previousValues: #"{"title":"A","notes":null}"#,
            createdAt: 101
        )

        let result = MutationCompactor.compact(pending: [first], incoming: second)
        #expect(result.toInsert == nil)

        let merged = try #require(result.toUpdate)
        #expect(merged.id == "u1")
        #expect(merged.actionEnum == .update)

        // Newer payload wins on conflicting keys, additive keys are preserved.
        let payload = decode(merged.payload) ?? [:]
        #expect(payload["title"] as? String == "B")
        #expect(payload["notes"] as? String == "hi")

        // Field union is deduplicated.
        let fields = decodeArray(merged.changedFields) ?? []
        #expect(Set(fields) == ["title", "notes"])
        #expect(fields.count == 2, "changedFields must be deduplicated")

        // previousValues keeps earliest-known value for "title" and records
        // a value for "notes" from the later mutation.
        let prev = decode(merged.previousValues ?? "") ?? [:]
        #expect(prev["title"] as? String == "original", "previousValues must keep the earliest recorded value")
        #expect(prev["notes"] is NSNull)
    }

    @Test func updatePlusDeleteDropsUpdate() throws {
        let existing = makeEntry(id: "u1", action: .update, payload: "{}", createdAt: 100)
        let delete = makeEntry(id: "d1", action: .delete, payload: "{}", createdAt: 101)

        let result = MutationCompactor.compact(pending: [existing], incoming: delete)

        #expect(result.toDelete == ["u1"])
        let toInsert = try #require(result.toInsert)
        #expect(toInsert.id == "d1")
        #expect(toInsert.actionEnum == .delete)
    }

    @Test func updateWithNoPriorPendingJustInserts() throws {
        let update = makeEntry(id: "solo", action: .update, payload: #"{"x":1}"#, createdAt: 100)

        let result = MutationCompactor.compact(pending: [], incoming: update)

        let toInsert = try #require(result.toInsert)
        #expect(toInsert.id == "solo")
        #expect(result.toUpdate == nil)
        #expect(result.toDelete.isEmpty)
    }

    // MARK: - JSON merge details

    @Test func payloadMergePreservesUnrelatedKeys() throws {
        let create = makeEntry(
            id: "mut",
            action: .create,
            payload: #"{"id":"item-1","title":"Hello","listId":"L","status":"active"}"#,
            createdAt: 100
        )
        let update = makeEntry(
            id: "mut2",
            action: .update,
            payload: #"{"status":"done"}"#,
            changedFields: #"["status"]"#,
            createdAt: 101
        )

        let result = MutationCompactor.compact(pending: [create], incoming: update)
        let merged = try #require(result.toUpdate)

        let payload = decode(merged.payload) ?? [:]
        #expect(payload["id"] as? String == "item-1")
        #expect(payload["title"] as? String == "Hello")
        #expect(payload["listId"] as? String == "L")
        #expect(payload["status"] as? String == "done", "conflicting key must take the newer value")
    }

    @Test func changedFieldsUnionDeduplicates() throws {
        let first = makeEntry(
            id: "u1",
            action: .update,
            payload: "{}",
            changedFields: #"["title","notes","title"]"#, // duplicate on purpose
            createdAt: 100
        )
        let second = makeEntry(
            id: "u2",
            action: .update,
            payload: "{}",
            changedFields: #"["notes","dueDate"]"#,
            createdAt: 101
        )

        let result = MutationCompactor.compact(pending: [first], incoming: second)
        let merged = try #require(result.toUpdate)
        let fields = decodeArray(merged.changedFields) ?? []

        #expect(Set(fields) == ["title", "notes", "dueDate"])
        #expect(fields.count == 3)
    }

    // MARK: - Helpers

    private func makeEntry(
        id: String,
        action: MutationAction,
        payload: String,
        changedFields: String? = nil,
        previousValues: String? = nil,
        createdAt seconds: TimeInterval
    ) -> MutationQueueEntry {
        let method: MutationMethod
        switch action {
        case .create: method = .post
        case .update: method = .patch
        case .delete: method = .delete
        case .custom: method = .post
        }
        return MutationQueueEntry(
            id: id,
            entityType: "item",
            entityId: "e1",
            action: action,
            endpoint: "/things",
            method: method,
            payload: payload,
            changedFields: changedFields,
            previousValues: previousValues,
            createdAt: Date(timeIntervalSince1970: seconds)
        )
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
