import Testing
import Foundation
import SwiftData
@testable import Brett

@Suite("ChatPersister", .tags(.smoke))
@MainActor
struct ChatPersisterTests {
    @Test func persistAssistantWritesBrettMessageRow() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let persister = ChatPersister(context: context)

        try persister.persistAssistant(
            content: "Hello from Brett.",
            itemId: "item-1",
            calendarEventId: nil,
            userId: "alice"
        )

        let descriptor = FetchDescriptor<BrettMessage>()
        let rows = try context.fetch(descriptor)
        #expect(rows.count == 1)
        #expect(rows[0].content == "Hello from Brett.")
        #expect(rows[0].itemId == "item-1")
        #expect(rows[0].calendarEventId == nil)
        #expect(rows[0].userId == "alice")
    }

    @Test func persistAssistantSkipsWhenContentIsEmpty() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let persister = ChatPersister(context: context)

        try persister.persistAssistant(
            content: "",
            itemId: "item-1",
            calendarEventId: nil,
            userId: "alice"
        )

        let rows = try context.fetch(FetchDescriptor<BrettMessage>())
        #expect(rows.isEmpty, "empty content should not produce a row")
    }

    @Test func persistAssistantSkipsWhenUserIdMissing() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let persister = ChatPersister(context: context)

        try persister.persistAssistant(
            content: "Has content but no user.",
            itemId: "item-1",
            calendarEventId: nil,
            userId: nil
        )

        let rows = try context.fetch(FetchDescriptor<BrettMessage>())
        #expect(rows.isEmpty, "missing userId should be a no-op")
    }
}
