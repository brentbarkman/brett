import Foundation
import Observation
import SwiftData

/// Tracks attachments for an item plus in-flight upload state.
/// Uploads are a two-phase flow (request presigned URL → PUT to S3 → confirm
/// with server) tracked in `AttachmentUpload`; once `markComplete` fires, the
/// real `Attachment` row is created locally with `storageKey`.
@MainActor
@Observable
final class AttachmentStore {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    convenience init() {
        self.init(context: PersistenceController.shared.mainContext)
    }

    // MARK: - Attachment queries

    /// Attachments for an item, optionally scoped to `userId`. Without the
    /// scope a pre-sync leftover row from a previous account could appear
    /// attached to a new user's item if the server happens to reuse the id.
    func fetchForItem(_ itemId: String, userId: String? = nil) -> [Attachment] {
        var descriptor = FetchDescriptor<Attachment>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        if let userId {
            descriptor.predicate = #Predicate { attachment in
                attachment.itemId == itemId
                    && attachment.userId == userId
                    && attachment.deletedAt == nil
            }
        } else {
            descriptor.predicate = #Predicate { attachment in
                attachment.itemId == itemId && attachment.deletedAt == nil
            }
        }
        return fetch(descriptor)
    }

    // MARK: - Upload lifecycle

    func createUpload(
        itemId: String,
        localPath: String,
        filename: String,
        mimeType: String,
        size: Int
    ) -> AttachmentUpload {
        let upload = AttachmentUpload(
            itemId: itemId,
            localFilePath: localPath,
            filename: filename,
            mimeType: mimeType,
            sizeBytes: size
        )
        context.insert(upload)
        save()
        return upload
    }

    /// After S3 confirmation: create the real Attachment row and mark the
    /// upload as done. Server should enqueue creation via the existing
    /// attachments route — we add a mutation queue entry here so the push
    /// engine treats it uniformly with other writes.
    func markComplete(uploadId: String, attachmentId: String, userId: String, storageKey: String) {
        var uploadDescriptor = FetchDescriptor<AttachmentUpload>()
        uploadDescriptor.predicate = #Predicate { $0.id == uploadId }
        uploadDescriptor.fetchLimit = 1

        guard let upload = fetch(uploadDescriptor).first else { return }

        upload.stage = AttachmentUploadStage.done.rawValue
        upload.storageKey = storageKey
        upload.uploadProgress = 1.0

        let attachment = Attachment(
            id: attachmentId,
            filename: upload.filename,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            storageKey: storageKey,
            itemId: upload.itemId,
            userId: userId
        )
        attachment._syncStatus = SyncStatus.synced.rawValue
        context.insert(attachment)

        save()
        // Upload path is handled by the uploader, but we still nudge the
        // sync manager so any other pending mutations (e.g. the parent item's
        // attachment list) flush promptly.
        ActiveSession.syncManager?.schedulePushDebounced()
    }

    func markFailed(uploadId: String, error: String) {
        var descriptor = FetchDescriptor<AttachmentUpload>()
        descriptor.predicate = #Predicate { $0.id == uploadId }
        descriptor.fetchLimit = 1

        guard let upload = fetch(descriptor).first else { return }

        upload.stage = AttachmentUploadStage.failed.rawValue
        upload.error = error
        upload.retryCount += 1

        save()
    }

    // MARK: - Internals

    private func fetch<T: PersistentModel>(_ descriptor: FetchDescriptor<T>) -> [T] {
        do {
            return try context.fetch(descriptor)
        } catch {
            BrettLog.store.error("AttachmentStore fetch failed: \(String(describing: error), privacy: .public)")
            return []
        }
    }

    private func save() {
        do {
            try context.save()
        } catch {
            BrettLog.store.error("AttachmentStore save failed: \(String(describing: error), privacy: .public)")
        }
    }
}
