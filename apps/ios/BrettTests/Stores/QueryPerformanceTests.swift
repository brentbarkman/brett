import XCTest
import SwiftData
@testable import Brett

/// Locks in Wave B's promise that moving the userId filter from a Swift
/// `.filter { ... }` post-fetch to a SwiftData `#Predicate` is at worst
/// neutral and at best a measurable improvement. If a future SwiftData
/// regression slows down captured-string predicates, this test catches
/// it before users feel it on Today/Inbox/Lists/Calendar.
///
/// Test framework note: this file uses XCTest rather than Swift Testing
/// because Swift Testing doesn't yet have a built-in performance harness.
/// The Wave A regression-guard tests use Swift Testing; performance
/// tests live alongside in XCTest. Both frameworks coexist in the
/// `BrettTests` target.
final class QueryPerformanceTests: XCTestCase {
    @MainActor
    func testTodayPredicateScalesWith2000Items() throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Seed 2000 items: 1500 alice, 500 bob. The mix isolates the cost
        // of the `userId == userId` predicate filter — without it the
        // fetch returns all 2000 rows.
        for i in 0..<1500 {
            context.insert(TestFixtures.makeItem(userId: "alice", title: "alice-\(i)"))
        }
        for i in 0..<500 {
            context.insert(TestFixtures.makeItem(userId: "bob", title: "bob-\(i)"))
        }
        try context.save()

        let userId = "alice"
        let predicate = #Predicate<Item> { $0.deletedAt == nil && $0.userId == userId }

        measure {
            let results = (try? context.fetch(FetchDescriptor<Item>(predicate: predicate))) ?? []
            XCTAssertEqual(results.count, 1500)
        }
    }
}
