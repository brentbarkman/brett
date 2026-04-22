import Foundation
import SwiftData
import Testing
@testable import Brett

/// Guards the sign-out wipe. `AuthManager.signOut` calls this after clearing
/// auth state so a subsequent sign-in on the same device never renders the
/// prior user's rows against the new user's identity.
///
/// The tests exercise the static form that accepts a context so each case
/// runs against its own in-memory container — no shared-singleton leakage.
@Suite("PersistenceController.wipeAllData", .tags(.auth, .smoke))
@MainActor
struct PersistenceControllerWipeTests {

    @Test func removesEveryInsertedRowAcrossAllDomainModels() throws {
        let context = try InMemoryPersistenceController.makeContext()

        // Seed one row in every user-scoped domain table the app persists.
        context.insert(TestFixtures.makeItem(title: "Pre-wipe item"))
        context.insert(TestFixtures.makeList(name: "Pre-wipe list"))
        context.insert(TestFixtures.makeEvent(title: "Pre-wipe event"))
        context.insert(TestFixtures.makeScout(name: "Pre-wipe scout"))
        context.insert(TestFixtures.makeFinding(title: "Pre-wipe finding"))
        context.insert(TestFixtures.makeUserProfile(email: "pre@wipe.test"))
        try context.save()

        #expect(try context.fetch(FetchDescriptor<Item>()).isEmpty == false)
        #expect(try context.fetch(FetchDescriptor<ItemList>()).isEmpty == false)
        #expect(try context.fetch(FetchDescriptor<CalendarEvent>()).isEmpty == false)
        #expect(try context.fetch(FetchDescriptor<Scout>()).isEmpty == false)
        #expect(try context.fetch(FetchDescriptor<ScoutFinding>()).isEmpty == false)
        #expect(try context.fetch(FetchDescriptor<UserProfile>()).isEmpty == false)

        PersistenceController.wipeAllData(in: context)

        #expect(try context.fetch(FetchDescriptor<Item>()).isEmpty)
        #expect(try context.fetch(FetchDescriptor<ItemList>()).isEmpty)
        #expect(try context.fetch(FetchDescriptor<CalendarEvent>()).isEmpty)
        #expect(try context.fetch(FetchDescriptor<Scout>()).isEmpty)
        #expect(try context.fetch(FetchDescriptor<ScoutFinding>()).isEmpty)
        #expect(try context.fetch(FetchDescriptor<UserProfile>()).isEmpty)
    }

    @Test func clearsSyncInfrastructureSoNextSignInStartsClean() throws {
        // Sync cursors, health rows, and mutation queue entries must also
        // clear: otherwise the pull engine thinks it already has everything
        // up to the prior user's cursor, and any offline mutations queued
        // under the prior user would try to push with the next user's token.
        let context = try InMemoryPersistenceController.makeContext()

        let cursor = SyncCursor(tableName: "items", lastSyncedAt: "2025-01-01T00:00:00Z")
        let health = SyncHealth()
        health.lastSuccessfulPullAt = Date()
        let mutation = MutationQueueEntry(
            entityType: "item",
            entityId: UUID().uuidString,
            action: .create,
            endpoint: "/items",
            method: .post,
            payload: "{}"
        )
        context.insert(cursor)
        context.insert(health)
        context.insert(mutation)
        try context.save()

        #expect(try context.fetch(FetchDescriptor<SyncCursor>()).isEmpty == false)
        #expect(try context.fetch(FetchDescriptor<SyncHealth>()).isEmpty == false)
        #expect(try context.fetch(FetchDescriptor<MutationQueueEntry>()).isEmpty == false)

        PersistenceController.wipeAllData(in: context)

        #expect(try context.fetch(FetchDescriptor<SyncCursor>()).isEmpty)
        #expect(try context.fetch(FetchDescriptor<SyncHealth>()).isEmpty)
        #expect(try context.fetch(FetchDescriptor<MutationQueueEntry>()).isEmpty)
    }

    @Test func isIdempotentAndSafeOnEmptyStore() throws {
        let context = try InMemoryPersistenceController.makeContext()

        // No seed data — first wipe should be a harmless no-op.
        PersistenceController.wipeAllData(in: context)
        PersistenceController.wipeAllData(in: context)

        #expect(try context.fetch(FetchDescriptor<Item>()).isEmpty)
        #expect(try context.fetch(FetchDescriptor<MutationQueueEntry>()).isEmpty)
    }

    @Test func doesNotAffectRowsInsertedAfterwards() throws {
        // Proves the wipe doesn't leave the context in a broken state —
        // a fresh insert right after still commits and reads back correctly.
        // Regression guard: if a future change left the context with a
        // dangling reference, this would fail on save or fetch.
        let context = try InMemoryPersistenceController.makeContext()
        context.insert(TestFixtures.makeItem(title: "Pre-wipe"))
        try context.save()

        PersistenceController.wipeAllData(in: context)

        context.insert(TestFixtures.makeItem(title: "Post-wipe"))
        try context.save()

        let remaining = try context.fetch(FetchDescriptor<Item>())
        #expect(remaining.count == 1)
        #expect(remaining.first?.title == "Post-wipe")
    }
}
