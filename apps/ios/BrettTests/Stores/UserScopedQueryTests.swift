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
}
