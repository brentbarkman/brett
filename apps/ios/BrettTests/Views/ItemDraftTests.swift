import Foundation
import SwiftData
import Testing
@testable import Brett

/// Tests for `ItemDraft` — the in-memory edit buffer for `TaskDetailView`.
///
/// The diff is the contract between the detail view and `ItemStore.update(...)`.
/// These tests pin the invariants:
///  - Unchanged fields produce an empty diff (no wasted mutations).
///  - Text fields treat empty string as nil.
///  - Dates with sub-millisecond drift are considered equal.
///  - `previousValues` carries the original value so the server can merge.
@MainActor
@Suite("ItemDraft", .tags(.views))
struct ItemDraftTests {

    // MARK: - Diff: empty

    @Test func noChangesYieldsEmptyDiff() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let item = TestFixtures.makeItem(title: "Hello", notes: "Old notes")
        context.insert(item)

        let draft = ItemDraft(from: item)
        let diff = draft.diff(against: item)

        #expect(diff.isEmpty)
        #expect(diff.changedFields.isEmpty)
    }

    // MARK: - Diff: simple field changes

    @Test func titleChangeProducesChange() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let item = TestFixtures.makeItem(title: "Original")
        context.insert(item)

        var draft = ItemDraft(from: item)
        draft.title = "Updated"

        let diff = draft.diff(against: item)
        #expect((diff.changes["title"] ?? nil) as? String == "Updated")
        #expect((diff.previousValues["title"] ?? nil) as? String == "Original")
        #expect(diff.changedFields == ["title"])
    }

    @Test func notesEmptyStringIsTreatedAsNil() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let item = TestFixtures.makeItem(title: "T", notes: "Existing notes")
        context.insert(item)

        var draft = ItemDraft(from: item)
        draft.notes = ""

        let diff = draft.diff(against: item)
        #expect(diff.changedFields.contains("notes"))
        // Empty string should have been normalised to NSNull (the explicit
        // "cleared" sentinel) so the key survives in the dict.
        let noteChange = diff.changes["notes"]
        #expect(noteChange?.base is NSNull)
    }

    @Test func notesNoChangeWhenBothEmpty() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let item = TestFixtures.makeItem(title: "T", notes: nil)
        context.insert(item)

        var draft = ItemDraft(from: item)
        draft.notes = "" // same as "nil" on the item

        let diff = draft.diff(against: item)
        #expect(!diff.changedFields.contains("notes"))
    }

    // MARK: - Diff: dates

    @Test func dateSubMillisecondDriftIsIgnored() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let dueDate = Date(timeIntervalSince1970: 1_700_000_000)
        let item = TestFixtures.makeItem(title: "T", dueDate: dueDate)
        context.insert(item)

        var draft = ItemDraft(from: item)
        // Re-encode trip — simulate the kind of micro-drift that comes from
        // JSON round-trips.
        draft.dueDate = Date(timeIntervalSince1970: 1_700_000_000.00001)

        let diff = draft.diff(against: item)
        #expect(!diff.changedFields.contains("dueDate"))
    }

    @Test func dateClearedProducesNilChange() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let item = TestFixtures.makeItem(title: "T", dueDate: Date(timeIntervalSince1970: 1_700_000_000))
        context.insert(item)

        var draft = ItemDraft(from: item)
        draft.dueDate = nil

        let diff = draft.diff(against: item)
        #expect(diff.changedFields == ["dueDate"])
        #expect(diff.previousValues["dueDate"] != nil)
    }

    // MARK: - Diff: lists, reminders, recurrence

    @Test func listIdRoundTripsThroughDiff() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let item = TestFixtures.makeItem(title: "T", listId: "list-a")
        context.insert(item)

        var draft = ItemDraft(from: item)
        draft.listId = "list-b"
        let diff = draft.diff(against: item)
        #expect((diff.changes["listId"] ?? nil) as? String == "list-b")
        #expect((diff.previousValues["listId"] ?? nil) as? String == "list-a")
    }

    @Test func reminderAndRecurrenceChangesAreIndependent() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let item = TestFixtures.makeItem(title: "T")
        context.insert(item)

        var draft = ItemDraft(from: item)
        draft.reminder = ReminderType.morningOf.rawValue
        draft.recurrence = RecurrenceType.weekly.rawValue
        let diff = draft.diff(against: item)

        #expect(Set(diff.changedFields) == Set(["reminder", "recurrence"]))
    }

    // MARK: - Commit path

    @Test func commitDelegatesToItemStoreUpdate() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(context: context)

        let item = TestFixtures.makeItem(id: "i-1", title: "Original")
        context.insert(item)
        try context.save()

        var draft = ItemDraft(from: item)
        draft.title = "Updated"
        draft.notes = "Fresh notes"

        let diff = draft.diff(against: item)
        store.commit(diff, to: item.id, userId: TestFixtures.defaultUserId)

        // Re-fetch and verify the update landed. Direct `FetchDescriptor`
        // because Wave B made `ItemStore.fetchById` private — tests inspect
        // post-mutation state without going through the store's mutation
        // surface.
        let itemId = item.id
        let descriptor = FetchDescriptor<Item>(
            predicate: #Predicate { $0.id == itemId }
        )
        let refetched = try context.fetch(descriptor).first
        #expect(refetched?.title == "Updated")
        #expect(refetched?.notes == "Fresh notes")

        // And a mutation queue entry exists.
        let mutations = try context.fetch(FetchDescriptor<MutationQueueEntry>())
        #expect(!mutations.isEmpty)
    }

    @Test func commitOnEmptyDiffIsNoOp() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let store = ItemStore(context: context)

        let item = TestFixtures.makeItem(id: "i-2", title: "Same")
        context.insert(item)
        try context.save()

        let draft = ItemDraft(from: item)
        let diff = draft.diff(against: item)
        store.commit(diff, to: item.id, userId: TestFixtures.defaultUserId)

        // No mutation queue entry should have been written.
        let mutations = try context.fetch(FetchDescriptor<MutationQueueEntry>())
        #expect(mutations.isEmpty)
    }
}
