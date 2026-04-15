import Testing
import Foundation
import SwiftData
@testable import Brett

/// Bare-minimum sanity checks. If these fail, something fundamental broke and
/// other agents' work likely can't run either. Keep these fast.
@Suite("Smoke", .tags(.smoke))
struct SmokeTests {
    @Test func modelContainerBootsWithFullSchema() throws {
        let container = try InMemoryPersistenceController.makeContainer()
        // Touch the container so the compiler can't optimize it away.
        #expect(container.schema.entities.isEmpty == false)
    }

    @MainActor
    @Test func canInsertAndFetchItem() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let item = TestFixtures.makeItem(title: "Smoke test item")
        context.insert(item)
        try context.save()

        let fetched = try context.fetch(FetchDescriptor<Item>())
        #expect(fetched.count == 1)
        #expect(fetched.first?.title == "Smoke test item")
    }

    @MainActor
    @Test func canInsertAcrossAllModels() throws {
        let context = try InMemoryPersistenceController.makeContext()
        context.insert(TestFixtures.makeItem())
        context.insert(TestFixtures.makeList())
        context.insert(TestFixtures.makeEvent())
        context.insert(TestFixtures.makeScout())
        context.insert(TestFixtures.makeFinding())
        context.insert(TestFixtures.makeUserProfile())
        try context.save()

        #expect(try context.fetch(FetchDescriptor<Item>()).count == 1)
        #expect(try context.fetch(FetchDescriptor<ItemList>()).count == 1)
        #expect(try context.fetch(FetchDescriptor<CalendarEvent>()).count == 1)
        #expect(try context.fetch(FetchDescriptor<Scout>()).count == 1)
        #expect(try context.fetch(FetchDescriptor<ScoutFinding>()).count == 1)
        #expect(try context.fetch(FetchDescriptor<UserProfile>()).count == 1)
    }
}
