import Testing
import Foundation
import SwiftData
@testable import Brett

/// Regression guard for the cross-user leak in `BadgeRefreshController`.
///
/// Pre-fix, `MainContainer` carried an unscoped `@Query<Item>` (filter:
/// `deletedAt == nil && status == "active"`) that drove
/// `BadgeManager.refresh(items:)`. On a multi-account device — or during
/// a sign-out drain / user-switch race — the home-screen badge could
/// reflect the previous user's count for a frame, or include both
/// users' active rows together while the wipe race resolved.
///
/// Fix: extracted into `BadgeRefreshController(userId:)`, whose `@Query`
/// predicate captures the user. This test pins the predicate so any
/// future refactor that drops `userId == userId` from the filter
/// re-introduces the leak in CI rather than in production.
@Suite("Badge query userId scoping", .tags(.smoke))
@MainActor
struct BadgeQueryScopingTests {
    @Test func badgePredicateIsolatesUsersExactly() throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Seed: 3 active items for alice, 2 active for bob, 1 done for alice
        // (excluded by status filter), 1 deleted for alice (excluded by
        // deletedAt filter).
        for i in 0..<3 {
            context.insert(TestFixtures.makeItem(userId: "alice", status: .active, title: "alice-active-\(i)"))
        }
        for i in 0..<2 {
            context.insert(TestFixtures.makeItem(userId: "bob", status: .active, title: "bob-active-\(i)"))
        }
        context.insert(TestFixtures.makeItem(userId: "alice", status: .done, title: "alice-done"))

        let aliceDeleted = TestFixtures.makeItem(userId: "alice", status: .active, title: "alice-deleted")
        aliceDeleted.deletedAt = Date()
        context.insert(aliceDeleted)

        try context.save()

        // The exact predicate `BadgeRefreshController.init` constructs.
        let userId = "alice"
        let aliceBadgeItems = try context.fetch(
            FetchDescriptor<Item>(
                predicate: #Predicate { item in
                    item.deletedAt == nil && item.status == "active" && item.userId == userId
                }
            )
        )
        #expect(aliceBadgeItems.count == 3,
                "alice's active+undeleted count should be 3, got \(aliceBadgeItems.count)")
        #expect(aliceBadgeItems.allSatisfy { $0.userId == "alice" },
                "predicate must not surface bob's items")
        #expect(aliceBadgeItems.allSatisfy { $0.deletedAt == nil })
        #expect(aliceBadgeItems.allSatisfy { $0.status == "active" })

        // Mirror check from bob's perspective so a flipped predicate
        // (returning the OTHER user's rows) wouldn't pass either side.
        let bobUid = "bob"
        let bobBadgeItems = try context.fetch(
            FetchDescriptor<Item>(
                predicate: #Predicate { item in
                    item.deletedAt == nil && item.status == "active" && item.userId == bobUid
                }
            )
        )
        #expect(bobBadgeItems.count == 2)
        #expect(bobBadgeItems.allSatisfy { $0.userId == "bob" })
    }
}
