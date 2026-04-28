import Testing
import Foundation
import SwiftData
@testable import Brett

/// Multi-user `@Query` scoping: a SwiftData predicate that captures
/// `userId` should isolate user A's rows from user B's. This protects
/// the multi-user invariant against the Wave B refactor that moved
/// `userId` from a Swift `.filter { ... }` into the `@Query` predicate
/// via init-based subviews like `TodayPageBody`.
@Suite("User-scoped @Query", .tags(.smoke))
@MainActor
struct UserScopedQueryTests {
    @Test func itemPredicateIsolatesUsersExactly() throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Seed: 3 items for alice, 2 for bob, all undeleted.
        for i in 0..<3 { context.insert(TestFixtures.makeItem(userId: "alice", title: "alice-\(i)")) }
        for i in 0..<2 { context.insert(TestFixtures.makeItem(userId: "bob",   title: "bob-\(i)")) }
        try context.save()

        let userId = "alice"
        let aliceItems = try context.fetch(
            FetchDescriptor<Item>(
                predicate: #Predicate { $0.deletedAt == nil && $0.userId == userId }
            )
        )
        #expect(aliceItems.count == 3)
        #expect(aliceItems.allSatisfy { $0.userId == "alice" })

        let bobUid = "bob"
        let bobItems = try context.fetch(
            FetchDescriptor<Item>(
                predicate: #Predicate { $0.deletedAt == nil && $0.userId == bobUid }
            )
        )
        #expect(bobItems.count == 2)
        #expect(bobItems.allSatisfy { $0.userId == "bob" })
    }

    @Test func listPredicateIsolatesUsersExactly() throws {
        let context = try InMemoryPersistenceController.makeContext()
        for i in 0..<3 { context.insert(TestFixtures.makeList(userId: "alice", name: "alice-\(i)")) }
        for i in 0..<2 { context.insert(TestFixtures.makeList(userId: "bob",   name: "bob-\(i)")) }
        try context.save()

        let userId = "alice"
        let aliceLists = try context.fetch(
            FetchDescriptor<ItemList>(
                predicate: #Predicate { $0.deletedAt == nil && $0.userId == userId }
            )
        )
        #expect(aliceLists.count == 3)
        #expect(aliceLists.allSatisfy { $0.userId == "alice" })

        let bobUid = "bob"
        let bobLists = try context.fetch(
            FetchDescriptor<ItemList>(
                predicate: #Predicate { $0.deletedAt == nil && $0.userId == bobUid }
            )
        )
        #expect(bobLists.count == 2)
        #expect(bobLists.allSatisfy { $0.userId == "bob" })
    }

    /// Coverage for the 3-clause predicate that `ListsPageBody` actually
    /// constructs (`deletedAt == nil && archivedAt == nil && userId == X`).
    /// The 2-clause case above doesn't exercise the archive filter, so a
    /// future refactor that drops `archivedAt == nil` from the predicate
    /// would silently start surfacing archived lists in the sidebar.
    @Test func listPredicateWithArchiveFilterIsolatesUsersExactly() throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Seed a mix: alice has 2 active + 1 archived, bob has 1 active.
        let aliceActive1 = TestFixtures.makeList(userId: "alice", name: "alice-active-1")
        let aliceActive2 = TestFixtures.makeList(userId: "alice", name: "alice-active-2")
        let aliceArchived = TestFixtures.makeList(userId: "alice", name: "alice-archived")
        aliceArchived.archivedAt = Date()
        let bobActive = TestFixtures.makeList(userId: "bob", name: "bob-active")

        context.insert(aliceActive1)
        context.insert(aliceActive2)
        context.insert(aliceArchived)
        context.insert(bobActive)
        try context.save()

        // The exact predicate ListsPageBody.init constructs.
        let userId = "alice"
        let aliceActiveLists = try context.fetch(
            FetchDescriptor<ItemList>(
                predicate: #Predicate { list in
                    list.deletedAt == nil && list.archivedAt == nil && list.userId == userId
                }
            )
        )
        #expect(aliceActiveLists.count == 2, "should exclude alice's archived list AND bob's lists")
        #expect(aliceActiveLists.allSatisfy { $0.userId == "alice" })
        #expect(aliceActiveLists.allSatisfy { $0.archivedAt == nil })
    }
}
