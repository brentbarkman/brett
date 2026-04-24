import Testing
import Foundation
import SwiftData
@testable import Brett

/// Scoped `fetchById(_:userId:)` on item / list / calendar stores — defense
/// in depth for the multi-user invariant. A row from a prior user that
/// survives an imperfect wipe must never be returned when the current
/// user's id is supplied.
@Suite("Scoped fetchById", .tags(.models), .serialized)
@MainActor
struct FetchByIdUserScopingTests {
    /// Shared id used to demonstrate that the lookup distinguishes by
    /// `userId`, not by id alone. In practice our ids are UUIDs so
    /// collision is astronomically unlikely — but relying on the ID space
    /// is not the multi-user safety contract. The contract is: pass a
    /// `userId` and only that user's row comes back.
    private let sharedId = "row-id-shared"

    private func makeItemHarness() throws -> (ItemStore, ModelContext) {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        return (ItemStore(context: context), context)
    }

    private func makeListHarness() throws -> (ListStore, ModelContext) {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        return (ListStore(context: context), context)
    }

    private func makeCalendarHarness() throws -> (CalendarStore, ModelContext) {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        return (CalendarStore(context: context), context)
    }

    // MARK: - ItemStore.fetchById

    @Test func itemFetchByIdWithoutUserIdReturnsAnyUser() throws {
        let (store, context) = try makeItemHarness()
        context.insert(Item(id: sharedId, userId: "alice", title: "alice item"))
        try context.save()

        // Unscoped lookup preserves the legacy behaviour (used by sync
        // internals) — any user's row matches.
        let hit = store.fetchById(sharedId)
        #expect(hit?.userId == "alice")
    }

    @Test func itemFetchByIdScopedToOtherUserReturnsNil() throws {
        let (store, context) = try makeItemHarness()
        context.insert(Item(id: sharedId, userId: "alice", title: "alice item"))
        try context.save()

        // "bob" requests a row that exists but belongs to "alice".
        #expect(store.fetchById(sharedId, userId: "bob") == nil)
    }

    @Test func itemFetchByIdScopedToSameUserReturnsRow() throws {
        let (store, context) = try makeItemHarness()
        context.insert(Item(id: sharedId, userId: "alice", title: "alice item"))
        try context.save()

        let hit = store.fetchById(sharedId, userId: "alice")
        #expect(hit?.userId == "alice")
        #expect(hit?.title == "alice item")
    }

    // MARK: - ListStore.fetchById

    @Test func listFetchByIdScopedToOtherUserReturnsNil() throws {
        let (store, context) = try makeListHarness()
        context.insert(ItemList(id: sharedId, userId: "alice", name: "alice list"))
        try context.save()

        #expect(store.fetchById(sharedId, userId: "bob") == nil)
    }

    @Test func listFetchByIdScopedToSameUserReturnsRow() throws {
        let (store, context) = try makeListHarness()
        context.insert(ItemList(id: sharedId, userId: "alice", name: "alice list"))
        try context.save()

        #expect(store.fetchById(sharedId, userId: "alice")?.name == "alice list")
    }

    // MARK: - CalendarStore.fetchById

    @Test func calendarFetchByIdScopedToOtherUserReturnsNil() throws {
        let (store, context) = try makeCalendarHarness()
        context.insert(CalendarEvent(
            id: sharedId,
            userId: "alice",
            googleAccountId: "acc",
            calendarListId: "cal",
            googleEventId: "evt",
            title: "e",
            startTime: Date(),
            endTime: Date().addingTimeInterval(3600)
        ))
        try context.save()

        #expect(store.fetchById(sharedId, userId: "bob") == nil)
    }

    @Test func calendarFetchNoteScopedToOtherUserReturnsNil() throws {
        let (store, context) = try makeCalendarHarness()
        context.insert(CalendarEventNote(
            calendarEventId: "evt-1",
            userId: "alice",
            content: "alice note"
        ))
        try context.save()

        #expect(store.fetchNote(for: "evt-1", userId: "bob") == nil)
    }

    @Test func calendarFetchNoteScopedToSameUserReturnsRow() throws {
        let (store, context) = try makeCalendarHarness()
        context.insert(CalendarEventNote(
            calendarEventId: "evt-1",
            userId: "alice",
            content: "alice note"
        ))
        try context.save()

        #expect(store.fetchNote(for: "evt-1", userId: "alice")?.content == "alice note")
    }
}
