import Foundation
import SwiftData

/// Reconciles pending share payloads written by `BrettShareExtension` into
/// the main app's SwiftData + mutation queue.
///
/// Runs on every `scenePhase` transition to `.active` (see `BrettApp`). Walks
/// the App Group `ShareQueue/` directory and for each payload file:
///
/// - Decodes the JSON → `SharePayload`
/// - Skips files younger than 2 seconds (avoids racing the extension's
///   in-flight POST + rename from `.pending.json` → `.posted.json`)
/// - Skips files whose `id` already appears in SwiftData (main app pulled the
///   item from the server between the share and this drain pass)
/// - Inserts an `Item` with `_syncStatus` = `.synced` (for `.posted.json`) or
///   `.pendingCreate` (for `.pending.json`). The latter also enqueues a
///   mutation in the shared `MutationQueue` with the extension's
///   idempotency key — if the extension's POST succeeded but the rename
///   didn't, the server recognises the retry and returns cached data.
/// - On success, deletes the queue file. On failure, moves to `failed/`.
@MainActor
final class ShareIngestor {
    static let shared: ShareIngestor = {
        ShareIngestor(
            context: PersistenceController.shared.mainContext,
            auth: nil, // Injected at app startup so we don't have to reach into @Environment here.
            queueDirectoryProvider: { SharedConfig.shareQueueDirectory() },
            failedDirectoryProvider: { SharedConfig.failedShareDirectory() }
        )
    }()

    /// Grace window before we attempt to reconcile a file. The extension
    /// writes `.pending.json`, POSTs, then renames to `.posted.json` — we
    /// don't want to read mid-rename.
    private let reconcileGraceWindow: TimeInterval = 2

    /// Age after which a file that still won't reconcile gets moved to
    /// `failed/` so it stops blocking the main queue.
    private let expiryWindow: TimeInterval = 60 * 60 * 24 * 7 // 7 days

    private let context: ModelContext
    private weak var authManager: AuthManager?
    private var isDraining: Bool = false

    /// Queue directory is injected so tests can point at a temp dir rather
    /// than the real App Group container. Returns nil in production when the
    /// App Group isn't entitled (misconfiguration).
    private let queueDirectoryProvider: () -> URL?
    private let failedDirectoryProvider: () -> URL?

    /// Invoked after a successful drain run that enqueued new mutations —
    /// production path triggers the active session's
    /// `schedulePushDebounced()` so the mutation leaves the device promptly.
    /// No-op when no session is active (nothing to push yet; next sign-in's
    /// debounced push will flush on its first mutation). Tests pass a no-op
    /// to avoid exercising the sync manager's network layer.
    private let onMutationsEnqueued: () -> Void

    /// Optional user-id override used by tests. When set, `drain()` uses
    /// this instead of whatever `AuthManager.currentUser?.id` says — lets
    /// tests exercise the full reconciliation path without constructing a
    /// real signed-in AuthManager.
    var userIdOverride: String?

    init(
        context: ModelContext,
        auth: AuthManager?,
        queueDirectoryProvider: @escaping () -> URL?,
        failedDirectoryProvider: @escaping () -> URL?,
        onMutationsEnqueued: @escaping () -> Void = { ActiveSession.syncManager?.schedulePushDebounced() }
    ) {
        self.context = context
        self.authManager = auth
        self.queueDirectoryProvider = queueDirectoryProvider
        self.failedDirectoryProvider = failedDirectoryProvider
        self.onMutationsEnqueued = onMutationsEnqueued
    }

    /// Called from `BrettApp` on startup so the ingestor knows which user
    /// the inserted Items should belong to.
    func configure(auth: AuthManager) {
        self.authManager = auth
    }

    // MARK: - Drain

    /// Scan the queue directory and reconcile any pending share payloads.
    /// Idempotent — safe to call as often as every scenePhase change.
    /// Returns the count of payloads processed this pass (for telemetry/tests).
    @discardableResult
    func drain() async -> Int {
        // Re-entrancy guard. Scene phase fires can cascade — we don't want
        // two drains racing each other through the same directory.
        guard !isDraining else { return 0 }
        isDraining = true
        defer { isDraining = false }

        guard let queueDir = queueDirectoryProvider() else {
            log("drain: App Group unavailable — skipping")
            return 0
        }
        guard let userId = userIdOverride ?? authManager?.currentUser?.id else {
            // Not signed in — leave the queue alone. The next post-sign-in
            // drain will pick everything up.
            return 0
        }

        let files = listQueueFiles(in: queueDir)
        guard !files.isEmpty else { return 0 }

        let queue = MutationQueue(context: context)
        let now = Date()
        var processed = 0

        for file in files {
            let age = now.timeIntervalSince(fileCreationDate(file) ?? now)

            if age < reconcileGraceWindow {
                continue // Extension might still be renaming.
            }
            if age > expiryWindow {
                moveToFailed(file, reason: "expired")
                continue
            }

            guard let payload = decodePayload(at: file) else {
                moveToFailed(file, reason: "decode")
                continue
            }

            // Defence against cross-user contamination: if the share was
            // captured under a different user-id than the one currently
            // signed in (user A shared → signed out → user B signed in),
            // refuse to import. Quarantines to failed/ so the payload is
            // visible to debug but can't leak into the wrong account.
            if let payloadUserId = payload.userId, payloadUserId != userId {
                moveToFailed(file, reason: "user-mismatch")
                continue
            }

            if itemAlreadyExists(id: payload.id) {
                // Pull already caught up. Drop the file; nothing to do.
                try? FileManager.default.removeItem(at: file)
                processed += 1
                continue
            }

            let isPosted = file.lastPathComponent.hasSuffix(".posted.json")
            insertItem(payload: payload, userId: userId, syncedViaExtension: isPosted)

            if !isPosted {
                enqueueMutation(payload: payload, userId: userId, queue: queue)
            }

            try? FileManager.default.removeItem(at: file)
            processed += 1
        }

        // One save at the end rather than per-file — cheaper and keeps the
        // inserted Items + their mutation entries atomic from the UI's POV.
        try? context.save()

        // Opportunistically trim `failed/` — moved-aside payloads can
        // accumulate indefinitely otherwise. 30-day retention is plenty
        // for debug triage.
        purgeExpiredFailed(olderThan: 30 * 24 * 60 * 60, now: now)

        // Kick sync so pending mutations leave the device promptly.
        // Injected so tests can substitute a no-op and avoid exercising
        // the shared SyncManager's network layer.
        if processed > 0 {
            onMutationsEnqueued()
        }

        return processed
    }

    private func purgeExpiredFailed(olderThan age: TimeInterval, now: Date) {
        guard let failedDir = failedDirectoryProvider() else { return }
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: failedDir,
            includingPropertiesForKeys: [.creationDateKey],
            options: [.skipsHiddenFiles]
        ) else {
            return
        }
        for file in entries {
            let created = fileCreationDate(file) ?? now
            if now.timeIntervalSince(created) > age {
                try? FileManager.default.removeItem(at: file)
            }
        }
    }

    // MARK: - Discovery

    private func listQueueFiles(in dir: URL) -> [URL] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.creationDateKey, .isDirectoryKey],
            options: [.skipsHiddenFiles, .skipsSubdirectoryDescendants]
        ) else {
            return []
        }
        return entries.filter { url in
            let name = url.lastPathComponent
            guard name.hasSuffix(".pending.json") || name.hasSuffix(".posted.json") else {
                return false
            }
            let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
            return !isDir
        }
    }

    private func fileCreationDate(_ url: URL) -> Date? {
        (try? url.resourceValues(forKeys: [.creationDateKey]))?.creationDate
    }

    private func decodePayload(at file: URL) -> SharePayload? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(SharePayload.self, from: data)
    }

    private func itemAlreadyExists(id: String) -> Bool {
        var descriptor = FetchDescriptor<Item>(
            predicate: #Predicate { $0.id == id }
        )
        descriptor.fetchLimit = 1
        return (try? context.fetch(descriptor).first) != nil
    }

    // MARK: - Insert

    private func insertItem(
        payload: SharePayload,
        userId: String,
        syncedViaExtension: Bool
    ) {
        let itemType = ItemType(rawValue: payload.type) ?? .task
        let item = Item(
            id: payload.id,
            userId: userId,
            type: itemType,
            status: .active,
            title: payload.title,
            source: payload.source,
            dueDate: nil,
            listId: nil,
            notes: payload.notes,
            createdAt: payload.createdAt,
            updatedAt: payload.createdAt
        )
        item.sourceUrl = payload.sourceUrl

        if syncedViaExtension {
            // Extension's POST succeeded — server already has this item.
            // Mark synced so the mutation queue doesn't try again, and
            // set _baseUpdatedAt so field-level merge has a reference point
            // when the user next edits this item before the next pull.
            item._syncStatus = SyncStatus.synced.rawValue
            item._baseUpdatedAt = payload.createdAt.iso8601String()
        } else {
            item._syncStatus = SyncStatus.pendingCreate.rawValue
        }

        context.insert(item)
    }

    private func enqueueMutation(
        payload: SharePayload,
        userId: String,
        queue: MutationQueue
    ) {
        var itemPayload: [String: Any] = [
            "id": payload.id,
            "type": payload.type,
            "status": "active",
            "title": payload.title,
            "userId": userId,
            "source": payload.source,
            "createdAt": payload.createdAt.iso8601String(),
            "updatedAt": payload.createdAt.iso8601String(),
        ]
        if let sourceUrl = payload.sourceUrl {
            itemPayload["sourceUrl"] = sourceUrl
        }
        if let notes = payload.notes {
            itemPayload["notes"] = notes
        }

        queue.enqueue(
            entityType: "item",
            entityId: payload.id,
            action: .create,
            endpoint: "/things",          // Informational only; PushEngine routes to /sync/push
            method: .post,
            payload: JSONCodec.encode(itemPayload),
            idempotencyKey: payload.idempotencyKey
        )
    }

    // MARK: - Failure handling

    private func moveToFailed(_ file: URL, reason: String) {
        guard let failedDir = failedDirectoryProvider() else {
            try? FileManager.default.removeItem(at: file)
            return
        }
        let destination = failedDir.appendingPathComponent(file.lastPathComponent)
        try? FileManager.default.removeItem(at: destination) // clear any prior attempt
        try? FileManager.default.moveItem(at: file, to: destination)
        log("drain: moved \(file.lastPathComponent) to failed/ (\(reason))")
    }

    private func log(_ message: String) {
        #if DEBUG
        NSLog("[ShareIngestor] %@", message)
        #endif
    }
}

// `Date.iso8601String()` lives on Date via an extension in ItemStore.swift —
// reused here so the serialisation format stays consistent with the rest of
// the mutation queue payloads.
