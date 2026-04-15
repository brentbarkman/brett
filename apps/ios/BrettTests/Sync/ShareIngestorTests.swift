import Testing
import Foundation
import SwiftData
@testable import Brett

/// Integration tests for `ShareIngestor.drain()` — the main-app side of the
/// share extension pipeline. Exercises payload decoding, item insertion,
/// mutation queueing, and the move-to-failed path using a real in-memory
/// SwiftData container + a temp directory standing in for the App Group.
@Suite("ShareIngestor")
@MainActor
struct ShareIngestorTests {

    // MARK: - Harness

    private static let testUserId = "ingestor-test-user"

    private func makeHarness() throws -> Harness {
        let container = try InMemoryPersistenceController.makeContainer()
        let context = ModelContext(container)

        let tempRoot = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("share-ingestor-tests-\(UUID().uuidString)", isDirectory: true)
        let queueDir = tempRoot.appendingPathComponent("ShareQueue", isDirectory: true)
        let failedDir = queueDir.appendingPathComponent("failed", isDirectory: true)
        try FileManager.default.createDirectory(at: queueDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: failedDir, withIntermediateDirectories: true)

        let ingestor = ShareIngestor(
            context: context,
            auth: nil,
            queueDirectoryProvider: { queueDir },
            failedDirectoryProvider: { failedDir },
            onMutationsEnqueued: {} // avoid exercising SyncManager's real push path in tests
        )
        ingestor.userIdOverride = Self.testUserId

        return Harness(
            context: context,
            queueDir: queueDir,
            failedDir: failedDir,
            ingestor: ingestor,
            tempRoot: tempRoot
        )
    }

    private struct Harness {
        let context: ModelContext
        let queueDir: URL
        let failedDir: URL
        let ingestor: ShareIngestor
        let tempRoot: URL

        func cleanup() {
            try? FileManager.default.removeItem(at: tempRoot)
        }
    }

    // MARK: - Helpers

    private func writePendingFile(payload: SharePayload, to dir: URL, age: TimeInterval = 10) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(payload)
        let url = dir.appendingPathComponent("\(payload.id).pending.json")
        try data.write(to: url, options: .atomic)
        try setCreationDate(on: url, age: age)
    }

    private func writePostedFile(payload: SharePayload, to dir: URL, age: TimeInterval = 10) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(payload)
        let url = dir.appendingPathComponent("\(payload.id).posted.json")
        try data.write(to: url, options: .atomic)
        try setCreationDate(on: url, age: age)
    }

    /// Backdate a file so it falls outside the 2s grace window.
    private func setCreationDate(on url: URL, age: TimeInterval) throws {
        let created = Date().addingTimeInterval(-age)
        try FileManager.default.setAttributes(
            [.creationDate: created, .modificationDate: created],
            ofItemAtPath: url.path
        )
    }

    private func fetchItems(in context: ModelContext) throws -> [Item] {
        let descriptor = FetchDescriptor<Item>(sortBy: [SortDescriptor(\.createdAt)])
        return try context.fetch(descriptor)
    }

    private func fetchMutations(in context: ModelContext) throws -> [MutationQueueEntry] {
        let descriptor = FetchDescriptor<MutationQueueEntry>(sortBy: [SortDescriptor(\.createdAt)])
        return try context.fetch(descriptor)
    }

    // MARK: - Pending payload → pending_create + mutation

    @Test func pendingFile_insertsItemAsPendingCreate_andEnqueuesMutation() async throws {
        let h = try makeHarness()
        defer { h.cleanup() }

        let payload = SharePayload.build(
            url: URL(string: "https://example.com/article"),
            text: "tagged commentary"
        )!
        try writePendingFile(payload: payload, to: h.queueDir)

        let processed = await h.ingestor.drain()

        #expect(processed == 1)

        let items = try fetchItems(in: h.context)
        #expect(items.count == 1)
        #expect(items[0].id == payload.id)
        #expect(items[0].userId == Self.testUserId)
        #expect(items[0].type == "content")
        #expect(items[0].title == payload.title)
        #expect(items[0].sourceUrl == payload.sourceUrl)
        #expect(items[0].notes == payload.notes)
        #expect(items[0].source == "ios_share")
        #expect(items[0]._syncStatus == SyncStatus.pendingCreate.rawValue)

        let mutations = try fetchMutations(in: h.context)
        #expect(mutations.count == 1)
        #expect(mutations[0].entityId == payload.id)
        #expect(mutations[0].action == MutationAction.create.rawValue)
        #expect(mutations[0].entityType == "item")
        #expect(mutations[0].idempotencyKey == payload.idempotencyKey,
                "idempotency key must be reused so a server-side retry from the extension dedups")

        // Queue file should be cleaned up.
        let remaining = try FileManager.default.contentsOfDirectory(atPath: h.queueDir.path)
        #expect(remaining == ["failed"])
    }

    // MARK: - Posted payload → synced, no mutation

    @Test func postedFile_insertsItemAsSynced_withNoMutation() async throws {
        let h = try makeHarness()
        defer { h.cleanup() }

        let payload = SharePayload.build(
            url: URL(string: "https://example.com/video"),
            text: nil
        )!
        try writePostedFile(payload: payload, to: h.queueDir)

        _ = await h.ingestor.drain()

        let items = try fetchItems(in: h.context)
        #expect(items.count == 1)
        #expect(items[0]._syncStatus == SyncStatus.synced.rawValue,
                "posted file means extension POST succeeded — item should not re-POST")
        #expect(items[0]._baseUpdatedAt != nil,
                "synced items need a baseUpdatedAt so field-level merge has a reference")

        let mutations = try fetchMutations(in: h.context)
        #expect(mutations.isEmpty, "no mutation should be enqueued for a .posted file")
    }

    // MARK: - Grace window

    @Test func fileYoungerThanGraceWindow_isSkipped() async throws {
        let h = try makeHarness()
        defer { h.cleanup() }

        let payload = SharePayload.build(url: URL(string: "https://example.com/"), text: nil)!
        try writePendingFile(payload: payload, to: h.queueDir, age: 0.5) // well under 2s

        let processed = await h.ingestor.drain()

        #expect(processed == 0, "files within the 2s rename-race window must not be reconciled yet")

        let items = try fetchItems(in: h.context)
        #expect(items.isEmpty)
    }

    // MARK: - Idempotency: existing item

    @Test func existingItemWithSameId_queueFileDropped_noDuplicateInserted() async throws {
        let h = try makeHarness()
        defer { h.cleanup() }

        let payload = SharePayload.build(url: URL(string: "https://example.com/dup"), text: nil)!

        // Seed SwiftData as if a pull already brought this item back.
        let existing = Item(
            id: payload.id,
            userId: Self.testUserId,
            type: .content,
            status: .active,
            title: "already synced",
            source: "ios_share",
            createdAt: Date(),
            updatedAt: Date()
        )
        existing._syncStatus = SyncStatus.synced.rawValue
        h.context.insert(existing)
        try h.context.save()

        try writePendingFile(payload: payload, to: h.queueDir)

        _ = await h.ingestor.drain()

        let items = try fetchItems(in: h.context)
        #expect(items.count == 1)
        #expect(items[0].title == "already synced", "existing item must not be overwritten")

        let remaining = try FileManager.default.contentsOfDirectory(atPath: h.queueDir.path)
        #expect(remaining == ["failed"], "queue file must be deleted once we know the item exists")
    }

    // MARK: - Malformed file → failed/

    @Test func malformedPayload_movedToFailedDirectory_noCrash() async throws {
        let h = try makeHarness()
        defer { h.cleanup() }

        let badFile = h.queueDir.appendingPathComponent("bogus.pending.json")
        try Data("not-json".utf8).write(to: badFile, options: .atomic)
        try setCreationDate(on: badFile, age: 10)

        let processed = await h.ingestor.drain()

        #expect(processed == 0, "malformed files don't count as processed")

        let items = try fetchItems(in: h.context)
        #expect(items.isEmpty)

        // File moved, not removed.
        #expect(!FileManager.default.fileExists(atPath: badFile.path))
        let failedContents = try FileManager.default.contentsOfDirectory(atPath: h.failedDir.path)
        #expect(failedContents.contains("bogus.pending.json"))
    }

    // MARK: - Expired file → failed/

    @Test func expiredFile_olderThanSevenDays_movedToFailed() async throws {
        let h = try makeHarness()
        defer { h.cleanup() }

        let payload = SharePayload.build(url: URL(string: "https://example.com/stale"), text: nil)!
        try writePendingFile(payload: payload, to: h.queueDir, age: 8 * 24 * 60 * 60)

        _ = await h.ingestor.drain()

        // Nothing inserted — expired files skip reconciliation and go to failed/
        let items = try fetchItems(in: h.context)
        #expect(items.isEmpty)

        let failedContents = try FileManager.default.contentsOfDirectory(atPath: h.failedDir.path)
        #expect(failedContents.contains("\(payload.id).pending.json"))
    }

    // MARK: - Cross-user contamination defence

    @Test func payloadFromDifferentUser_movedToFailed_notImported() async throws {
        let h = try makeHarness()
        defer { h.cleanup() }

        // Build a payload explicitly stamped with a DIFFERENT user id.
        let stranger = SharePayload.build(
            url: URL(string: "https://example.com/secret"),
            text: nil,
            userId: "user-who-shared-before-sign-out"
        )!
        try writePendingFile(payload: stranger, to: h.queueDir)

        // Ingestor is configured for `testUserId` — different from the
        // payload's stamped user.
        _ = await h.ingestor.drain()

        let items = try fetchItems(in: h.context)
        #expect(items.isEmpty, "payload from another user must NOT be inserted into the current user's account")

        let failedContents = try FileManager.default.contentsOfDirectory(atPath: h.failedDir.path)
        #expect(failedContents.contains("\(stranger.id).pending.json"),
                "mismatched-user payload should be quarantined to failed/, not deleted or imported")
    }

    @Test func payloadWithNoUserId_importedUnderCurrentUser() async throws {
        // Backwards-compat: payloads written by an older extension (no
        // userId stamped) still import under whoever is signed in now.
        let h = try makeHarness()
        defer { h.cleanup() }

        let legacy = SharePayload.build(
            url: URL(string: "https://example.com/legacy"),
            text: nil,
            userId: nil
        )!
        try writePendingFile(payload: legacy, to: h.queueDir)

        _ = await h.ingestor.drain()

        let items = try fetchItems(in: h.context)
        #expect(items.count == 1)
        #expect(items[0].userId == Self.testUserId)
    }

    // MARK: - Not signed in → no-op

    @Test func notSignedIn_leavesQueueIntact() async throws {
        let h = try makeHarness()
        defer { h.cleanup() }

        h.ingestor.userIdOverride = nil // drop the override, no real AuthManager configured

        let payload = SharePayload.build(url: URL(string: "https://example.com/"), text: nil)!
        try writePendingFile(payload: payload, to: h.queueDir)

        let processed = await h.ingestor.drain()
        #expect(processed == 0)

        let remaining = try FileManager.default.contentsOfDirectory(atPath: h.queueDir.path)
        #expect(remaining.contains("\(payload.id).pending.json"),
                "without a signed-in user, queue files stay put for the next drain")
    }

    // MARK: - Mixed directory

    @Test func mixedPendingPostedExistingAndMalformed_allHandledCorrectly() async throws {
        let h = try makeHarness()
        defer { h.cleanup() }

        let pending = SharePayload.build(url: URL(string: "https://example.com/a"), text: nil)!
        let posted = SharePayload.build(url: URL(string: "https://example.com/b"), text: nil)!
        try writePendingFile(payload: pending, to: h.queueDir)
        try writePostedFile(payload: posted, to: h.queueDir)

        let malformed = h.queueDir.appendingPathComponent("garbage.posted.json")
        try Data("{".utf8).write(to: malformed, options: .atomic)
        try setCreationDate(on: malformed, age: 10)

        let processed = await h.ingestor.drain()
        #expect(processed == 2, "two valid files processed; malformed counted separately via move-to-failed")

        let items = try fetchItems(in: h.context)
        let ids = Set(items.map(\.id))
        #expect(ids == Set([pending.id, posted.id]))

        // One pending mutation (for the pending file only).
        let mutations = try fetchMutations(in: h.context)
        #expect(mutations.count == 1)
        #expect(mutations[0].entityId == pending.id)
    }
}
