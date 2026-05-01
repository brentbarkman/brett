import Testing
import Foundation
import SwiftData
@testable import Brett

/// Multi-user scoping tests for stores that still expose public read
/// methods (Calendar / Message / Attachment). The Wave A.4 invariant —
/// "user A's rows never surface in a fetch scoped to user B" — is the
/// same one `UserScopedQueryTests` enforces for `Item`/`ItemList` (now
/// served via `@Query` directly).
///
/// Wave B deleted the public `fetchAll`/`fetchInbox`/`fetchToday`/
/// `fetchUpcoming` methods on `ItemStore` and `fetchAll` on `ListStore`;
/// the equivalent multi-user scoping invariants are now covered by:
///   - `UserScopedQueryTests` (predicate-shape on `Item` + `ItemList`)
///   - `SyncInternalQueryTests` (unscoped lookups for sync internals)
@Suite("Multi-user scoping")
@MainActor
struct UserScopedFetchTests {

    // MARK: - Harness

    struct Harness {
        let container: ModelContainer
        let context: ModelContext
        let calendarStore: CalendarStore
        let messageStore: MessageStore
        let attachmentStore: AttachmentStore
    }

    private func makeHarness() throws -> Harness {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)
        return Harness(
            container: container,
            context: context,
            calendarStore: CalendarStore(context: context),
            messageStore: MessageStore(context: context),
            attachmentStore: AttachmentStore(context: context)
        )
    }

    // MARK: - CalendarStore

    @Test func calendarFetchEventsScopedToUser() throws {
        let h = try makeHarness()
        let now = Date()
        let soon = now.addingTimeInterval(3600)
        let later = now.addingTimeInterval(7200)

        let alice = CalendarEvent(
            userId: "alice",
            googleAccountId: "g1",
            calendarListId: "c1",
            googleEventId: "ge1",
            title: "A standup",
            startTime: now,
            endTime: soon
        )
        let bob = CalendarEvent(
            userId: "bob",
            googleAccountId: "g1",
            calendarListId: "c1",
            googleEventId: "ge2",
            title: "B standup",
            startTime: now,
            endTime: soon
        )
        h.context.insert(alice)
        h.context.insert(bob)
        try h.context.save()

        let aliceEvents = h.calendarStore.fetchEvents(
            userId: "alice",
            startDate: now.addingTimeInterval(-1),
            endDate: later
        )
        #expect(aliceEvents.map(\.title) == ["A standup"])

        let bobEvents = h.calendarStore.fetchEvents(
            userId: "bob",
            startDate: now.addingTimeInterval(-1),
            endDate: later
        )
        #expect(bobEvents.map(\.title) == ["B standup"])
    }

    @Test func calendarDateRangePredicateRunsInSQLite() throws {
        // The overlap predicate (startTime < endDate AND endTime > startDate)
        // was moved from Swift post-filter into the SQLite predicate in
        // Wave A. Verify: events outside the window don't come back, even
        // when userId matches.
        let h = try makeHarness()
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let inWindow = CalendarEvent(
            userId: "alice",
            googleAccountId: "g1",
            calendarListId: "c1",
            googleEventId: "e-in",
            title: "in",
            startTime: base.addingTimeInterval(1800),
            endTime: base.addingTimeInterval(3000)
        )
        let outside = CalendarEvent(
            userId: "alice",
            googleAccountId: "g1",
            calendarListId: "c1",
            googleEventId: "e-out",
            title: "out",
            startTime: base.addingTimeInterval(-7200),
            endTime: base.addingTimeInterval(-3600)
        )
        h.context.insert(inWindow)
        h.context.insert(outside)
        try h.context.save()

        let fetched = h.calendarStore.fetchEvents(
            userId: "alice",
            startDate: base,
            endDate: base.addingTimeInterval(3600)
        )
        #expect(fetched.map(\.title) == ["in"])
    }

    // MARK: - MessageStore

    @Test func messagesScopedToUser() throws {
        let h = try makeHarness()
        h.context.insert(BrettMessage(userId: "alice", role: .user, content: "a", itemId: "shared"))
        h.context.insert(BrettMessage(userId: "bob", role: .user, content: "b", itemId: "shared"))
        try h.context.save()

        #expect(h.messageStore.fetchForItem("shared", userId: "alice").count == 1)
        #expect(h.messageStore.fetchForItem("shared", userId: "bob").count == 1)
    }

    // MARK: - AttachmentStore

    @Test func attachmentsScopedToUser() throws {
        let h = try makeHarness()
        h.context.insert(Attachment(
            filename: "a.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey: "k1",
            itemId: "shared",
            userId: "alice"
        ))
        h.context.insert(Attachment(
            filename: "b.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storageKey: "k2",
            itemId: "shared",
            userId: "bob"
        ))
        try h.context.save()

        #expect(h.attachmentStore.fetchForItem("shared", userId: "alice").map(\.filename) == ["a.pdf"])
        #expect(h.attachmentStore.fetchForItem("shared", userId: "bob").map(\.filename) == ["b.pdf"])
    }
}
