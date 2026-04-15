import Testing
import Foundation
import SwiftData
@testable import Brett

/// Verifies `ConflictLogEntry` rows are written correctly when the push engine
/// records a conflict and that the history survives app restarts.
///
/// Complementary to `ConflictResolverTests` (which tests the pure merge
/// algorithm): these tests cover the persistence-side effects and history.
@Suite("ConflictLog", .tags(.sync))
@MainActor
struct ConflictLogTests {
    // MARK: - Fields captured correctly

    @Test func logEntryCapturesEveryField() throws {
        let context = try InMemoryPersistenceController.makeContext()

        let local: [String: Any] = [
            "title": "Local title",
            "status": "active",
        ]
        let server: [String: Any] = [
            "title": "Server title",
            "status": "active",
        ]

        ConflictResolver.logConflict(
            entityType: "item",
            entityId: "item-1",
            mutationId: "mut-abc",
            localValues: local,
            serverValues: server,
            conflictedFields: ["title"],
            resolution: "server_wins",
            context: context
        )

        let logs: [ConflictLogEntry] = try context.fetch(FetchDescriptor<ConflictLogEntry>())
        #expect(logs.count == 1)

        let entry = logs.first!
        #expect(entry.entityType == "item")
        #expect(entry.entityId == "item-1")
        #expect(entry.mutationId == "mut-abc")
        #expect(entry.resolution == "server_wins")
        #expect(entry.resolvedAt != nil)

        // JSON payloads round-trip through JSONSerialization — don't assume
        // key ordering, just parse and check contents.
        let localParsed = (try? JSONSerialization.jsonObject(with: Data(entry.localValuesJSON.utf8))) as? [String: Any]
        #expect(localParsed?["title"] as? String == "Local title")

        let serverParsed = (try? JSONSerialization.jsonObject(with: Data(entry.serverValuesJSON.utf8))) as? [String: Any]
        #expect(serverParsed?["title"] as? String == "Server title")

        let fieldsParsed = (try? JSONSerialization.jsonObject(with: Data(entry.conflictedFieldsJSON.utf8))) as? [String]
        #expect(fieldsParsed == ["title"])
    }

    // MARK: - Multiple conflicts on same entity all logged

    @Test func repeatedConflictsOnSameEntityAllGetLogged() throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Simulate three distinct pushes that all conflict on the same item.
        for idx in 0..<3 {
            ConflictResolver.logConflict(
                entityType: "item",
                entityId: "item-repeat",
                mutationId: "mut-\(idx)",
                localValues: ["title": "Local v\(idx)"],
                serverValues: ["title": "Server v\(idx)"],
                conflictedFields: ["title"],
                resolution: "server_wins",
                context: context
            )
        }

        let logs: [ConflictLogEntry] = try context.fetch(FetchDescriptor<ConflictLogEntry>())
        #expect(logs.count == 3, "each conflict must get its own row — no dedupe")

        // All three entries should have distinct mutation ids but the same
        // entity id.
        let entityIds = logs.map(\.entityId)
        let mutationIds = logs.compactMap(\.mutationId).sorted()
        #expect(Set(entityIds) == ["item-repeat"])
        #expect(mutationIds == ["mut-0", "mut-1", "mut-2"])
    }

    // MARK: - Merged vs server_wins resolution recorded faithfully

    @Test func differentResolutionsAreDistinguished() throws {
        let context = try InMemoryPersistenceController.makeContext()

        ConflictResolver.logConflict(
            entityType: "item",
            entityId: "item-A",
            mutationId: "m-1",
            localValues: ["title": "A"],
            serverValues: ["title": "A'"],
            conflictedFields: ["title"],
            resolution: "merged",
            context: context
        )
        ConflictResolver.logConflict(
            entityType: "list",
            entityId: "list-B",
            mutationId: "m-2",
            localValues: ["name": "B"],
            serverValues: ["name": "B'"],
            conflictedFields: ["name"],
            resolution: "server_wins",
            context: context
        )

        let logs: [ConflictLogEntry] = try context.fetch(FetchDescriptor<ConflictLogEntry>())
        let merged = logs.first(where: { $0.resolution == "merged" })
        let serverWins = logs.first(where: { $0.resolution == "server_wins" })

        #expect(merged?.entityType == "item")
        #expect(serverWins?.entityType == "list")
    }

    // MARK: - Persistence across app restart (container re-open)

    @Test func logSurvivesContainerReopenWithSameStore() throws {
        // Simulate app restart by creating a fresh ModelContext against the
        // same in-memory `ModelContainer`. The rows written through the first
        // context must still be visible through the second.
        let container = try InMemoryPersistenceController.makeContainer()

        // Write a log entry through context A, save, then drop.
        do {
            let ctxA = ModelContext(container)
            ConflictResolver.logConflict(
                entityType: "item",
                entityId: "item-persist",
                mutationId: "mut-persist",
                localValues: ["title": "old"],
                serverValues: ["title": "new"],
                conflictedFields: ["title"],
                resolution: "server_wins",
                context: ctxA
            )
            // `logConflict` calls `try? context.save()` internally, but be
            // defensive and also save directly — mirrors what PushEngine does.
            try ctxA.save()
        }

        // Fresh context — same underlying container. Represents a new launch
        // where SwiftData reads from the existing SQLite file.
        let ctxB = ModelContext(container)
        let logs: [ConflictLogEntry] = try ctxB.fetch(FetchDescriptor<ConflictLogEntry>())
        #expect(logs.count == 1)
        #expect(logs.first?.entityId == "item-persist")
    }

    // MARK: - Invalid JSON payload — logConflict still writes

    @Test func logConflictHandlesNonJSONValuesSafely() throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Include a value that JSONSerialization refuses (Date is not valid
        // JSON). The logger should fall back to a wrapper dict rather than
        // crash and should still insert a row.
        let dictWithWeirdValue: [String: Any] = ["raw": Date()]
        ConflictResolver.logConflict(
            entityType: "item",
            entityId: "item-weird",
            mutationId: nil,
            localValues: dictWithWeirdValue,
            serverValues: ["title": "ok"],
            conflictedFields: ["title"],
            resolution: "server_wins",
            context: context
        )

        // Confirm the row was inserted even if the JSON serialization had
        // to fall back.
        let logs: [ConflictLogEntry] = try context.fetch(FetchDescriptor<ConflictLogEntry>())
        #expect(logs.count == 1)
        #expect(logs.first?.entityId == "item-weird")
        // The local values JSON should be a valid JSON string (either the
        // original dict — if Foundation accepted it — or the `{"value":...}`
        // fallback).
        let parsedLocal = try? JSONSerialization.jsonObject(with: Data(logs.first!.localValuesJSON.utf8))
        #expect(parsedLocal != nil)
    }
}
