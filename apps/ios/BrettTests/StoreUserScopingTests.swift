import Foundation
import SwiftData
import Testing
@testable import Brett

/// Guards user-scoped fetches in the data layer. Every `*Store.fetchAll`
/// variant under test here must return only rows owned by the passed-in
/// `userId` — a row belonging to another user on the same device must
/// never surface, even if `PersistenceController.wipeAllData` missed it
/// (e.g. a new `@Model` added without being wired into the wipe).
@Suite("Store user scoping", .tags(.auth, .models))
@MainActor
struct StoreUserScopingTests {

    // MARK: - ItemStore

    @Test func fetchAllReturnsOnlyItemsOwnedByTheGivenUser() throws {
        let context = try InMemoryPersistenceController.makeContext()
        context.insert(TestFixtures.makeItem(userId: "user-a", title: "A1"))
        context.insert(TestFixtures.makeItem(userId: "user-a", title: "A2"))
        context.insert(TestFixtures.makeItem(userId: "user-b", title: "B1"))
        try context.save()

        let store = ItemStore(context: context)
        let aItems = store.fetchAll(userId: "user-a")
        let bItems = store.fetchAll(userId: "user-b")

        #expect(aItems.count == 2)
        #expect(aItems.allSatisfy { $0.userId == "user-a" })
        #expect(bItems.count == 1)
        #expect(bItems.first?.userId == "user-b")
    }

    @Test func fetchAllWithListIdStaysScopedToUser() throws {
        // A listId collision across users (e.g., pre-wipe schema drift) must
        // never let one user see another user's items on the same list.
        let context = try InMemoryPersistenceController.makeContext()
        context.insert(TestFixtures.makeItem(userId: "user-a", title: "A-list1", listId: "list-1"))
        context.insert(TestFixtures.makeItem(userId: "user-b", title: "B-list1", listId: "list-1"))
        try context.save()

        let store = ItemStore(context: context)
        let aOnList1 = store.fetchAll(userId: "user-a", listId: "list-1")

        #expect(aOnList1.count == 1)
        #expect(aOnList1.first?.title == "A-list1")
    }

    @Test func fetchInboxIsUserScoped() throws {
        let context = try InMemoryPersistenceController.makeContext()
        context.insert(TestFixtures.makeItem(userId: "user-a", title: "A inbox", dueDate: nil, listId: nil))
        context.insert(TestFixtures.makeItem(userId: "user-b", title: "B inbox", dueDate: nil, listId: nil))
        try context.save()

        let store = ItemStore(context: context)
        let inbox = store.fetchInbox(userId: "user-a")

        #expect(inbox.count == 1)
        #expect(inbox.first?.userId == "user-a")
    }

    @Test func fetchTodayIsUserScoped() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let today = Date()
        context.insert(TestFixtures.makeItem(userId: "user-a", title: "A today", dueDate: today))
        context.insert(TestFixtures.makeItem(userId: "user-b", title: "B today", dueDate: today))
        try context.save()

        let store = ItemStore(context: context)
        let aToday = store.fetchToday(userId: "user-a")

        #expect(aToday.count == 1)
        #expect(aToday.first?.userId == "user-a")
    }

    @Test func fetchUpcomingIsUserScoped() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let tomorrow = Date().addingTimeInterval(86_400 * 2)
        context.insert(TestFixtures.makeItem(userId: "user-a", title: "A tomorrow", dueDate: tomorrow))
        context.insert(TestFixtures.makeItem(userId: "user-b", title: "B tomorrow", dueDate: tomorrow))
        try context.save()

        let store = ItemStore(context: context)
        let aUpcoming = store.fetchUpcoming(userId: "user-a")

        #expect(aUpcoming.count == 1)
        #expect(aUpcoming.first?.userId == "user-a")
    }

    // MARK: - ListStore

    @Test func listStoreFetchAllIsUserScoped() throws {
        let context = try InMemoryPersistenceController.makeContext()
        context.insert(TestFixtures.makeList(userId: "user-a", name: "A Work"))
        context.insert(TestFixtures.makeList(userId: "user-a", name: "A Home"))
        context.insert(TestFixtures.makeList(userId: "user-b", name: "B Work"))
        try context.save()

        let store = ListStore(context: context)
        let aLists = store.fetchAll(userId: "user-a")
        let bLists = store.fetchAll(userId: "user-b")

        #expect(aLists.count == 2)
        #expect(aLists.allSatisfy { $0.userId == "user-a" })
        #expect(bLists.count == 1)
        #expect(bLists.first?.name == "B Work")
    }

    // MARK: - CalendarStore

    @Test func fetchEventsIsUserScoped() throws {
        let context = try InMemoryPersistenceController.makeContext()
        let now = Date()
        let windowStart = now.addingTimeInterval(-3_600)
        let windowEnd = now.addingTimeInterval(7_200)

        context.insert(TestFixtures.makeEvent(
            userId: "user-a",
            title: "A standup",
            startTime: now,
            endTime: now.addingTimeInterval(1_800)
        ))
        context.insert(TestFixtures.makeEvent(
            userId: "user-b",
            title: "B standup",
            startTime: now,
            endTime: now.addingTimeInterval(1_800)
        ))
        try context.save()

        let store = CalendarStore(context: context)
        let aEvents = store.fetchEvents(userId: "user-a", startDate: windowStart, endDate: windowEnd)

        #expect(aEvents.count == 1)
        #expect(aEvents.first?.userId == "user-a")
    }

    // MARK: - Empty-userId safety

    @Test func emptyUserIdYieldsEmptyResults() throws {
        // Views pass `authManager.currentUser?.id ?? ""` or bail on nil. If
        // a store call ever lands with an empty userId (race condition
        // during sign-out), it must not match any row — even a hypothetical
        // row with a blank userId would be a bug-marker, not signed-in data.
        let context = try InMemoryPersistenceController.makeContext()
        context.insert(TestFixtures.makeItem(userId: "user-a", title: "Legit"))
        try context.save()

        let itemStore = ItemStore(context: context)
        let listStore = ListStore(context: context)

        #expect(itemStore.fetchAll(userId: "").isEmpty)
        #expect(itemStore.fetchInbox(userId: "").isEmpty)
        #expect(itemStore.fetchToday(userId: "").isEmpty)
        #expect(itemStore.fetchUpcoming(userId: "").isEmpty)
        #expect(listStore.fetchAll(userId: "").isEmpty)
    }
}
