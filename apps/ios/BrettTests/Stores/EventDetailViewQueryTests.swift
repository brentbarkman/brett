import Testing
import Foundation
import SwiftData
@testable import Brett

/// Regression guard for the cross-user defense gap that
/// `EventDetailView` had pre-Wave-D-followup. The view fetched events
/// via `calendarStore.fetchById(eventId)` without scoping by userId,
/// which meant a stale eventId from a prior user's session could
/// resolve a foreign-user `CalendarEvent` row before sign-out's
/// `wipeAllData()` ran. This test pins the predicate shape used in
/// `EventDetailBody.init(userId:eventId:)`.
///
/// `CalendarEvent.id` is `@Attribute(.unique)`, so a SwiftData store
/// can only hold ONE row per id at a time. The cross-user threat is
/// "the lingering row's id matches what the new view is asking for"
/// — i.e. the new user opens an event detail keyed by an id that
/// SwiftData still holds for the prior user. The predicate's job is
/// to require both the id AND the current user's id to match;
/// otherwise the query returns empty and `EventDetailBody` falls
/// through to its loading placeholder instead of rendering a foreign
/// user's data.
@Suite("EventDetailView @Query scoping", .tags(.smoke))
@MainActor
struct EventDetailViewQueryTests {
    @Test func eventPredicateIsolatesUsersExactly() throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Alice's row lingers in SwiftData — simulating an unfinished wipe.
        let aliceEvent = TestFixtures.makeEvent(userId: "alice", title: "Alice meeting")
        context.insert(aliceEvent)
        // Bob owns a separate event with a different id, but if his UI
        // ever asks for `aliceEvent.id` (e.g. a stale push notification)
        // the predicate must NOT resolve to Alice's row.
        let bobEvent = TestFixtures.makeEvent(userId: "bob", title: "Bob meeting")
        context.insert(bobEvent)
        try context.save()

        let aliceUid = "alice"
        let bobUid = "bob"
        let staleId = aliceEvent.id

        // Alice's predicate matches her row.
        let aliceMatch = try context.fetch(
            FetchDescriptor<CalendarEvent>(
                predicate: #Predicate { $0.id == staleId && $0.userId == aliceUid }
            )
        ).first
        #expect(aliceMatch?.userId == "alice")
        #expect(aliceMatch?.title == "Alice meeting")

        // Bob's predicate against the same id returns NOTHING — even
        // though SwiftData holds a row with that exact id, the user
        // filter rejects it.
        let bobLeak = try context.fetch(
            FetchDescriptor<CalendarEvent>(
                predicate: #Predicate { $0.id == staleId && $0.userId == bobUid }
            )
        ).first
        #expect(bobLeak == nil)

        // Sanity: Bob's predicate against his own event id returns his row.
        let bobOwnId = bobEvent.id
        let bobOwn = try context.fetch(
            FetchDescriptor<CalendarEvent>(
                predicate: #Predicate { $0.id == bobOwnId && $0.userId == bobUid }
            )
        ).first
        #expect(bobOwn?.userId == "bob")
        #expect(bobOwn?.title == "Bob meeting")
    }
}
