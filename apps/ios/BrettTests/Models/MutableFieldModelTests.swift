import Testing
import Foundation
import SwiftData
@testable import Brett

/// Tests the `MutableFieldModel` protocol + its Item/ItemList conformances.
///
/// These tests guard the invariant that snapshot / apply / patchPayload /
/// previousValues stay in lock-step. Before this refactor, adding a field
/// to one of the four parallel switches and forgetting the others would
/// silently drop it from conflict resolution or the wire payload. If a
/// future field is added to `Item.Field` without wiring `value(for:)` or
/// `set(_:for:)`, these tests start failing — which is the whole point.
@Suite("MutableFieldModel")
@MainActor
struct MutableFieldModelTests {

    // MARK: - Snapshot + previousValues

    @Test func snapshotIncludesEveryMutableField() throws {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        let item = Item(userId: "u1", title: "hello")
        context.insert(item)

        let snapshot = item.mutableFieldSnapshot()

        // Every declared mutable field must be present — missing keys are
        // the original bug this refactor fixes. Unset optionals appear as
        // NSNull so the distinction between "clear" and "omit" survives
        // a round-trip through JSON.
        for field in Item.mutableFields {
            #expect(snapshot[field.rawValue] != nil, "missing field \(field.rawValue)")
        }

        #expect(snapshot["title"] as? String == "hello")
        #expect(snapshot["notes"] is NSNull)
        #expect(snapshot["dueDate"] is NSNull)
    }

    @Test func previousValuesReturnsOnlyRequestedFields() throws {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        let item = Item(userId: "u1", title: "original", notes: "n1")
        context.insert(item)

        let prev = item.previousValues(forFields: ["title", "notes", "bogus"])

        #expect(prev["title"] as? String == "original")
        #expect(prev["notes"] as? String == "n1")
        // Unknown fields are silently skipped so inbound server keys never
        // crash the app if the schema adds a field we don't know yet.
        #expect(prev["bogus"] == nil)
        #expect(prev.count == 2)
    }

    // MARK: - Apply

    @Test func applyUpdatesKnownFieldsOnly() throws {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        let item = Item(userId: "u1", title: "before")
        context.insert(item)

        item.apply(changes: [
            "title": "after",
            "notes": "new notes",
            "not-a-field": "should be ignored",
        ])

        #expect(item.title == "after")
        #expect(item.notes == "new notes")
    }

    @Test func applyTreatsNSNullAsClearForOptionalFields() throws {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        let item = Item(userId: "u1", title: "t", notes: "should clear")
        context.insert(item)

        item.apply(changes: ["notes": NSNull()])
        #expect(item.notes == nil)
    }

    @Test func applyRefusesToWipeRequiredFieldsWithNil() throws {
        // Guard against a bad server payload nuking `title` / `status` /
        // `type` — the Item wouldn't have a sane default and SwiftUI views
        // would render garbage. Setter must no-op on nil/NSNull for required
        // fields instead.
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        let item = Item(userId: "u1", title: "preserved")
        context.insert(item)

        item.apply(changes: [
            "title": NSNull(),
            "status": NSNull(),
            "type": NSNull(),
        ])

        #expect(item.title == "preserved")
        #expect(item.status == ItemStatus.active.rawValue)
        #expect(item.type == ItemType.task.rawValue)
    }

    @Test func applyCoercesISOStringToDate() throws {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        let item = Item(userId: "u1", title: "t")
        context.insert(item)

        let iso = "2026-05-01T15:30:00.000Z"
        item.apply(changes: ["dueDate": iso])

        #expect(item.dueDate != nil)
        // Round-trip: server → client → server should yield the same ISO.
        #expect(item.dueDate?.iso8601String() == iso)
    }

    // MARK: - patchPayload

    @Test func patchPayloadContainsOnlyRequestedFields() throws {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        let item = Item(userId: "u1", title: "t", notes: "n")
        item.dueDate = Date(timeIntervalSince1970: 1_700_000_000)
        context.insert(item)

        let payload = item.patchPayload(for: ["title", "dueDate", "garbage"])

        #expect(payload["title"] as? String == "t")
        #expect(payload["dueDate"] is Date) // Raw Date; JSONCodec handles ISO conversion.
        #expect(payload["garbage"] == nil)
        #expect(payload["notes"] == nil)
    }

    // MARK: - ItemList conformance

    @Test func listFieldMapRoundTrips() throws {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        let list = ItemList(userId: "u1", name: "Work", colorClass: "bg-blue-500", sortOrder: 3)
        context.insert(list)

        let snap = list.mutableFieldSnapshot()
        #expect(snap["name"] as? String == "Work")
        #expect(snap["colorClass"] as? String == "bg-blue-500")
        #expect(snap["sortOrder"] as? Int == 3)
        #expect(snap["archivedAt"] is NSNull)

        list.apply(changes: ["name": "Home", "sortOrder": 5, "archivedAt": Date()])

        #expect(list.name == "Home")
        #expect(list.sortOrder == 5)
        #expect(list.archivedAt != nil)

        list.apply(changes: ["archivedAt": NSNull()])
        #expect(list.archivedAt == nil)
    }

    // MARK: - Protocol-level invariant

    @Test func everyItemFieldHasGetterAndSetter() throws {
        // Ensures nobody adds a `case` to Item.Field without wiring both
        // switches — silent drops were the original bug. If this fails,
        // one of Item+Fields.swift's switches is missing a case.
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        let item = Item(userId: "u1", title: "t")
        context.insert(item)

        for field in Item.Field.allCases {
            // Getter must not trap and should return a value or nil.
            _ = item.value(for: field)

            // Setter is idempotent for the no-op case; ensures the switch
            // covers every case (missing cases would cause a compiler error
            // in an exhaustive switch, but this catches any runtime guards).
            item.set(item.value(for: field), for: field)
        }
    }
}
