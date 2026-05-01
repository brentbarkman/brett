import Testing
import Foundation
import SwiftData
@testable import Brett

/// Scoped `fetchById(_:userId:)` on `CalendarStore` — defense in depth
/// for the multi-user invariant. A row from a prior user that survives
/// an imperfect wipe must never be returned when the current user's id
/// is supplied.
///
/// Wave B deleted the equivalent public methods on `ItemStore` and
/// `ListStore`; their multi-user invariants are now covered by the
/// predicate shape verified in `UserScopedQueryTests` plus the
/// unscoped-fetch invariant in `SyncInternalQueryTests`.
@Suite("Scoped fetchById", .tags(.models), .serialized)
@MainActor
struct FetchByIdUserScopingTests {
    /// Shared id used to demonstrate that the lookup distinguishes by
    /// `userId`, not by id alone. In practice our ids are UUIDs so
    /// collision is astronomically unlikely — but relying on the ID space
    /// is not the multi-user safety contract. The contract is: pass a
    /// `userId` and only that user's row comes back.
    private let sharedId = "row-id-shared"

    private func makeCalendarHarness() throws -> (CalendarStore, ModelContext) {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        return (CalendarStore(context: context), context)
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
