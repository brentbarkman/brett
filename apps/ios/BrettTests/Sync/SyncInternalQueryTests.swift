import Testing
import Foundation
import SwiftData
@testable import Brett

/// Sync engine internals work with rows by id alone (no userId scope) —
/// the mutation queue and pull engine process rows server-side identified,
/// not user-scoped. This invariant used to live in
/// `UserScopedFetchTests.fetchAllNilUserReturnsAllRowsForSyncInternals`
/// and `FetchByIdUserScopingTests.itemFetchByIdWithoutUserIdReturnsAnyUser`,
/// before Wave B deleted the public store fetch methods. This test file
/// pins the same invariant on direct `FetchDescriptor` queries.
@Suite("Sync internal queries", .tags(.sync))
@MainActor
struct SyncInternalQueryTests {
    @Test func unscopedItemFetchReturnsRowsForAllUsers() throws {
        let context = try InMemoryPersistenceController.makeContext()
        for i in 0..<3 { context.insert(TestFixtures.makeItem(userId: "alice", title: "alice-\(i)")) }
        for i in 0..<2 { context.insert(TestFixtures.makeItem(userId: "bob",   title: "bob-\(i)")) }
        try context.save()

        let descriptor = FetchDescriptor<Item>(
            predicate: #Predicate { $0.deletedAt == nil }
        )
        let items = try context.fetch(descriptor)
        #expect(items.count == 5)
    }

    @Test func itemFetchByIdAcceptsAnyUser() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let alice = TestFixtures.makeItem(userId: "alice", title: "alice-row")
        let bob = TestFixtures.makeItem(userId: "bob", title: "bob-row")
        context.insert(alice)
        context.insert(bob)
        try context.save()

        let aliceId = alice.id
        let aliceDescriptor = FetchDescriptor<Item>(
            predicate: #Predicate { $0.id == aliceId }
        )
        let aliceMatch = try context.fetch(aliceDescriptor).first
        #expect(aliceMatch != nil)
        #expect(aliceMatch?.userId == "alice")

        let bobId = bob.id
        let bobDescriptor = FetchDescriptor<Item>(
            predicate: #Predicate { $0.id == bobId }
        )
        let bobMatch = try context.fetch(bobDescriptor).first
        #expect(bobMatch != nil)
        #expect(bobMatch?.userId == "bob")
    }
}
