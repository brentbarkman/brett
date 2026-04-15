import Testing
import Foundation
@testable import Brett

/// Exercises the pure three-way merge. These checks must match the server's
/// merge semantics in `apps/api/src/lib/sync-merge.ts`: for every `changedField`,
/// if the server's current value matches what the client thought it had,
/// the client's new value wins; otherwise the server wins and the field is
/// reported as conflicted.
@Suite("ConflictResolver.fieldLevelMerge", .tags(.sync))
struct ConflictResolverTests {
    // MARK: - Happy path

    @Test func fieldUnchangedOnServer_clientWins() {
        let current: [String: Any] = ["title": "Plan launch", "status": "active"]
        let previousValues: [String: Any] = ["title": "Plan launch"]
        let payload: [String: Any] = ["title": "Ship launch"]
        let changedFields = ["title"]

        let outcome = ConflictResolver.fieldLevelMerge(
            current: current,
            changedFields: changedFields,
            payload: payload,
            previousValues: previousValues
        )

        #expect(outcome.conflictedFields.isEmpty)
        #expect((outcome.merged["title"] as? String) == "Ship launch")
    }

    // MARK: - Full conflict

    @Test func fieldChangedOnServer_serverWins() {
        // Server raced ahead: title was "Plan launch" when client read it,
        // but the server now has "Plan release". Our write conflicts.
        let current: [String: Any] = ["title": "Plan release"]
        let previousValues: [String: Any] = ["title": "Plan launch"]
        let payload: [String: Any] = ["title": "Ship launch"]
        let changedFields = ["title"]

        let outcome = ConflictResolver.fieldLevelMerge(
            current: current,
            changedFields: changedFields,
            payload: payload,
            previousValues: previousValues
        )

        #expect(outcome.conflictedFields == ["title"])
        // Merged dict should retain the server's value on the conflicted field
        // so the caller can blindly apply it locally.
        #expect((outcome.merged["title"] as? String) == "Plan release")
    }

    // MARK: - Mixed conflict + non-conflict

    @Test func multipleFields_mixed() {
        let current: [String: Any] = [
            "title": "Plan release",      // diverged from previous
            "status": "active",           // matches previous
            "notes": "Updated yesterday", // matches previous
        ]
        let previousValues: [String: Any] = [
            "title": "Plan launch",
            "status": "active",
            "notes": "Updated yesterday",
        ]
        let payload: [String: Any] = [
            "title": "Ship launch",
            "status": "done",
            "notes": "Final notes",
        ]
        let changedFields = ["title", "status", "notes"]

        let outcome = ConflictResolver.fieldLevelMerge(
            current: current,
            changedFields: changedFields,
            payload: payload,
            previousValues: previousValues
        )

        #expect(outcome.conflictedFields == ["title"])
        #expect((outcome.merged["title"] as? String) == "Plan release")
        #expect((outcome.merged["status"] as? String) == "done")
        #expect((outcome.merged["notes"] as? String) == "Final notes")
    }

    // MARK: - Empty changedFields

    @Test func emptyChangedFields_emptyMerged() {
        let outcome = ConflictResolver.fieldLevelMerge(
            current: ["title": "Plan"],
            changedFields: [],
            payload: ["title": "Ship"],
            previousValues: ["title": "Plan"]
        )

        #expect(outcome.merged.isEmpty)
        #expect(outcome.conflictedFields.isEmpty)
    }

    // MARK: - Nil handling

    @Test func nilPreviousAndServer_clientWins() {
        // Both sides missing → server effectively unchanged since we read it.
        let outcome = ConflictResolver.fieldLevelMerge(
            current: [:],
            changedFields: ["dueDate"],
            payload: ["dueDate": "2026-05-01T00:00:00.000Z"],
            previousValues: [:]
        )
        #expect(outcome.conflictedFields.isEmpty)
        #expect((outcome.merged["dueDate"] as? String) == "2026-05-01T00:00:00.000Z")
    }

    @Test func serverHasValueButClientThoughtNil_conflicts() {
        let outcome = ConflictResolver.fieldLevelMerge(
            current: ["dueDate": "2026-06-01T00:00:00.000Z"],
            changedFields: ["dueDate"],
            payload: ["dueDate": "2026-05-01T00:00:00.000Z"],
            previousValues: [:]
        )
        #expect(outcome.conflictedFields == ["dueDate"])
    }

    // MARK: - deepEqual coverage

    @Test func deepEqualHandlesNSNullAndNil() {
        #expect(ConflictResolver.deepEqual(nil, nil))
        #expect(ConflictResolver.deepEqual(NSNull(), NSNull()))
        #expect(ConflictResolver.deepEqual(nil, NSNull()))
        #expect(ConflictResolver.deepEqual(NSNull(), nil))
    }

    @Test func deepEqualHandlesMixedIntDouble() {
        // Prisma returns numbers as JSON; Swift surfaces some as Int, some as Double.
        #expect(ConflictResolver.deepEqual(1, 1.0))
        #expect(ConflictResolver.deepEqual(NSNumber(value: 2), 2))
    }

    @Test func deepEqualRejectsStringVsNumber() {
        // A field that arrived as "1" (string) shouldn't be equal to 1 (number).
        // Bool vs Int is intentionally NOT covered here: Obj-C bridging makes
        // `Bool` and `NSNumber(value:1)` compare equal, which matches the
        // tolerance of `JSON.stringify` deep equality on the server in the
        // fields we care about. A field's JSON type is consistent per column.
        #expect(!ConflictResolver.deepEqual("1", 1))
    }
}
