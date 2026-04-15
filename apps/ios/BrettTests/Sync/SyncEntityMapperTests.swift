import Testing
import Foundation
import SwiftData
@testable import Brett

/// Verifies each `@Model` type round-trips cleanly between the server JSON
/// shape (Prisma camelCase) and the local SwiftData representation, with
/// special attention to fields renamed to dodge Swift reserved words.
@Suite("SyncEntityMapper", .tags(.sync))
struct SyncEntityMapperTests {
    // MARK: - Item

    @Test func itemRoundTripPreservesAllFields() {
        let server: [String: Any] = [
            "id": "item-1",
            "userId": "user-1",
            "type": "task",
            "status": "active",
            "title": "Write the sync engine",
            "description": "Field-level merge + cursor advancement",
            "notes": "Remember to test edge cases",
            "source": "Brett",
            "sourceId": NSNull(),
            "sourceUrl": NSNull(),
            "dueDate": "2026-05-01T14:00:00.000Z",
            "dueDatePrecision": "day",
            "completedAt": NSNull(),
            "snoozedUntil": NSNull(),
            "reminder": "day_before",
            "recurrence": "weekly",
            "recurrenceRule": NSNull(),
            "brettObservation": "Ambitious scope",
            "brettTakeGeneratedAt": NSNull(),
            "contentType": NSNull(),
            "contentStatus": NSNull(),
            "contentTitle": NSNull(),
            "contentDescription": NSNull(),
            "contentImageUrl": NSNull(),
            "contentBody": NSNull(),
            "contentFavicon": NSNull(),
            "contentDomain": NSNull(),
            "contentMetadata": NSNull(),
            "listId": "list-1",
            "meetingNoteId": NSNull(),
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T10:00:00.000Z",
        ]

        let item = SyncEntityMapper.itemFromServerJSON(server)
        try? #require(item != nil)
        guard let item else { return }

        #expect(item.id == "item-1")
        #expect(item.userId == "user-1")
        #expect(item.title == "Write the sync engine")
        #expect(item.itemDescription == "Field-level merge + cursor advancement")
        #expect(item.notes == "Remember to test edge cases")
        #expect(item.reminder == "day_before")
        #expect(item.recurrence == "weekly")
        #expect(item.brettObservation == "Ambitious scope")
        #expect(item.listId == "list-1")
        #expect(item.dueDatePrecision == "day")
        #expect(item.dueDate != nil)

        // Round-trip back through toServerPayload
        let back = SyncEntityMapper.toServerPayload(item)
        #expect(back["id"] as? String == "item-1")
        #expect(back["title"] as? String == "Write the sync engine")
        // Reserved-word field must land on `description` server-side.
        #expect(back["description"] as? String == "Field-level merge + cursor advancement")
        #expect(back["notes"] as? String == "Remember to test edge cases")
        #expect(back["listId"] as? String == "list-1")
        // Null-valued fields should encode as NSNull so the server sees an
        // explicit null (not a missing key).
        #expect(back["sourceId"] is NSNull)
    }

    @Test func itemFromServerMissingRequired_returnsNil() {
        // Without `title` we can't construct an Item.
        let invalid: [String: Any] = ["id": "x", "userId": "u"]
        #expect(SyncEntityMapper.itemFromServerJSON(invalid) == nil)
    }

    // MARK: - ItemList

    @Test func listRoundTrip() {
        let server: [String: Any] = [
            "id": "list-1",
            "userId": "user-1",
            "name": "Today",
            "colorClass": "bg-gold-500",
            "sortOrder": 3,
            "archivedAt": NSNull(),
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T10:00:00.000Z",
        ]
        let list = SyncEntityMapper.listFromServerJSON(server)
        try? #require(list != nil)
        guard let list else { return }
        #expect(list.name == "Today")
        #expect(list.colorClass == "bg-gold-500")
        #expect(list.sortOrder == 3)

        let back = SyncEntityMapper.toServerPayload(list)
        #expect(back["id"] as? String == "list-1")
        #expect(back["colorClass"] as? String == "bg-gold-500")
        #expect(back["sortOrder"] as? Int == 3)
    }

    // MARK: - CalendarEvent (reserved-word mapping)

    @Test func calendarEventReservedDescriptionRoundTrips() {
        let server: [String: Any] = [
            "id": "evt-1",
            "userId": "user-1",
            "googleAccountId": "ga-1",
            "calendarListId": "primary",
            "googleEventId": "g-1",
            "title": "Sprint planning",
            "description": "Quarterly roadmap review",
            "startTime": "2026-05-01T15:00:00.000Z",
            "endTime": "2026-05-01T16:00:00.000Z",
            "isAllDay": false,
            "status": "confirmed",
            "myResponseStatus": "accepted",
            "organizer": ["email": "lead@example.com", "name": "Team Lead"],
            "attendees": [["email": "a@example.com"], ["email": "b@example.com"]],
            "attachments": NSNull(),
            "rawGoogleEvent": ["id": "g-1", "extendedProperties": ["priv": ["a": "1"]]],
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T10:00:00.000Z",
        ]
        let event = SyncEntityMapper.calendarEventFromServerJSON(server)
        try? #require(event != nil)
        guard let event else { return }

        #expect(event.eventDescription == "Quarterly roadmap review")
        #expect(event.organizerJSON?.contains("lead@example.com") == true)
        #expect(event.attendeesJSON?.contains("a@example.com") == true)
        #expect(event.rawGoogleEventJSON?.contains("extendedProperties") == true)

        let back = SyncEntityMapper.toServerPayload(event)
        // reserved-word field lands on `description`
        #expect(back["description"] as? String == "Quarterly roadmap review")
        // JSON columns round-trip as dicts/arrays (not strings)
        #expect(back["organizer"] is [String: Any])
        #expect(back["attendees"] is [[String: Any]])
        #expect(back["rawGoogleEvent"] is [String: Any])
    }

    // MARK: - CalendarEventNote

    @Test func calendarEventNoteRoundTrip() {
        let server: [String: Any] = [
            "id": "note-1",
            "calendarEventId": "evt-1",
            "userId": "user-1",
            "content": "Remember to circulate the agenda.",
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T10:00:00.000Z",
        ]
        let note = SyncEntityMapper.calendarEventNoteFromServerJSON(server)
        try? #require(note != nil)
        #expect(note?.content == "Remember to circulate the agenda.")

        let back = SyncEntityMapper.toServerPayload(note!)
        #expect(back["content"] as? String == "Remember to circulate the agenda.")
    }

    // MARK: - Scout (JSON sources field)

    @Test func scoutSourcesJSONRoundTrips() {
        let sources: [[String: Any]] = [
            ["name": "TechCrunch"],
            ["name": "Hacker News", "url": "https://news.ycombinator.com"],
        ]
        let server: [String: Any] = [
            "id": "scout-1",
            "userId": "user-1",
            "name": "AI Updates",
            "avatarLetter": "A",
            "avatarGradientFrom": "#4682C3",
            "avatarGradientTo": "#E8B931",
            "goal": "Track AI developments",
            "context": NSNull(),
            "sources": sources,
            "sensitivity": "high",
            "analysisTier": "deep",
            "cadenceIntervalHours": 12.0,
            "cadenceMinIntervalHours": 1.0,
            "cadenceCurrentIntervalHours": 12.0,
            "budgetTotal": 200,
            "budgetUsed": 0,
            "status": "active",
            "bootstrapped": false,
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T10:00:00.000Z",
        ]
        let scout = SyncEntityMapper.scoutFromServerJSON(server)
        try? #require(scout != nil)
        guard let scout else { return }

        #expect(scout.name == "AI Updates")
        #expect(scout.sensitivity == "high")
        #expect(scout.analysisTier == "deep")
        // JSON sources stored as encoded string
        #expect(scout.sourcesJSON?.contains("TechCrunch") == true)
        #expect(scout.sourcesJSON?.contains("news.ycombinator") == true)

        let back = SyncEntityMapper.toServerPayload(scout)
        // Going out, sources must be a JSON array again (not a string)
        let backSources = back["sources"] as? [[String: Any]]
        try? #require(backSources != nil)
        #expect(backSources?.count == 2)
    }

    // MARK: - ScoutFinding (reserved-word description)

    @Test func scoutFindingReservedDescriptionRoundTrips() {
        let server: [String: Any] = [
            "id": "finding-1",
            "scoutId": "scout-1",
            "type": "insight",
            "title": "Big news",
            "description": "Company announced something",
            "sourceName": "TechCrunch",
            "sourceUrl": "https://example.com",
            "relevanceScore": 0.9,
            "reasoning": "Matches goals keywords",
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T10:00:00.000Z",
        ]
        let finding = SyncEntityMapper.scoutFindingFromServerJSON(server)
        try? #require(finding != nil)
        #expect(finding?.findingDescription == "Company announced something")

        let back = SyncEntityMapper.toServerPayload(finding!)
        #expect(back["description"] as? String == "Company announced something")
    }

    // MARK: - BrettMessage

    @Test func brettMessageRoundTrip() {
        let server: [String: Any] = [
            "id": "msg-1",
            "userId": "user-1",
            "itemId": "item-1",
            "calendarEventId": NSNull(),
            "role": "brett",
            "content": "Heads up — your next meeting is in 10 min.",
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T10:00:00.000Z",
        ]
        let msg = SyncEntityMapper.brettMessageFromServerJSON(server)
        try? #require(msg != nil)
        #expect(msg?.role == "brett")
        #expect(msg?.itemId == "item-1")
        #expect(msg?.calendarEventId == nil)

        let back = SyncEntityMapper.toServerPayload(msg!)
        #expect(back["role"] as? String == "brett")
    }

    // MARK: - Attachment

    @Test func attachmentRoundTrip() {
        let server: [String: Any] = [
            "id": "att-1",
            "filename": "design.pdf",
            "mimeType": "application/pdf",
            "sizeBytes": 12345,
            "storageKey": "users/user-1/items/item-1/design.pdf",
            "itemId": "item-1",
            "userId": "user-1",
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T10:00:00.000Z",
        ]
        let att = SyncEntityMapper.attachmentFromServerJSON(server)
        try? #require(att != nil)
        #expect(att?.filename == "design.pdf")
        #expect(att?.sizeBytes == 12345)

        let back = SyncEntityMapper.toServerPayload(att!)
        #expect(back["filename"] as? String == "design.pdf")
        #expect(back["sizeBytes"] as? Int == 12345)
    }

    // MARK: - Dates + JSON helpers

    @Test func parseDateHandlesFractionalAndPlainISO8601() {
        #expect(SyncEntityMapper.parseDate("2026-04-14T00:00:00.000Z") != nil)
        #expect(SyncEntityMapper.parseDate("2026-04-14T00:00:00Z") != nil)
        #expect(SyncEntityMapper.parseDate("not a date") == nil)
        #expect(SyncEntityMapper.parseDate(nil) == nil)
    }

    @Test func isoStringIsNilForNilDate() {
        #expect(SyncEntityMapper.isoString(nil) == nil)
        let d = Date(timeIntervalSince1970: 1_700_000_000)
        let s = SyncEntityMapper.isoString(d)
        try? #require(s != nil)
        // Must end with Z (UTC) and contain fractional seconds.
        #expect(s?.hasSuffix("Z") == true)
    }

    // MARK: - Upsert (respectLocalPending)

    @MainActor
    @Test func upsertSkipsLocalPendingRecord() throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Seed a local Item that has an uncommitted write (pending_update).
        let existing = Item(
            id: "item-1",
            userId: "user-1",
            title: "Local edit"
        )
        existing._syncStatus = SyncStatus.pendingUpdate.rawValue
        context.insert(existing)
        try context.save()

        // Server says title is something different — pull engine calls upsert.
        let server: [String: Any] = [
            "id": "item-1",
            "userId": "user-1",
            "type": "task",
            "status": "active",
            "title": "Server value",
            "source": "Brett",
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T12:00:00.000Z",
        ]
        SyncEntityMapper.upsert(
            tableName: "items",
            record: server,
            context: context,
            respectLocalPending: true
        )

        // Local title should stay as "Local edit" — server write was skipped.
        let fetched: [Item] = (try? context.fetch(FetchDescriptor<Item>())) ?? []
        #expect(fetched.first?.title == "Local edit")
    }

    @MainActor
    @Test func upsertOverwritesSyncedRecord() throws {
        let context = try InMemoryPersistenceController.makeContext()

        let existing = Item(id: "item-1", userId: "user-1", title: "Old")
        existing._syncStatus = SyncStatus.synced.rawValue
        context.insert(existing)
        try context.save()

        let server: [String: Any] = [
            "id": "item-1",
            "userId": "user-1",
            "type": "task",
            "status": "active",
            "title": "New",
            "source": "Brett",
            "createdAt": "2026-04-14T00:00:00.000Z",
            "updatedAt": "2026-04-14T12:00:00.000Z",
        ]
        SyncEntityMapper.upsert(
            tableName: "items",
            record: server,
            context: context,
            respectLocalPending: true
        )

        let fetched: [Item] = (try? context.fetch(FetchDescriptor<Item>())) ?? []
        #expect(fetched.first?.title == "New")
        #expect(fetched.first?._syncStatus == SyncStatus.synced.rawValue)
    }

    @MainActor
    @Test func hardDeleteRemovesLocalRecord() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let item = Item(id: "item-1", userId: "user-1", title: "Doomed")
        context.insert(item)
        try context.save()

        SyncEntityMapper.hardDelete(tableName: "items", id: "item-1", context: context)

        let fetched: [Item] = (try? context.fetch(FetchDescriptor<Item>())) ?? []
        #expect(fetched.isEmpty)
    }
}
