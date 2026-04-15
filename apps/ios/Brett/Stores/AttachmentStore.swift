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

    func fetchForItem(_ itemId: String) -> [Attachment] {
        var descriptor = FetchDescriptor<Attachment>(
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        descriptor.predicate = #Predicate { attachment in
            attachment.itemId == itemId && attachment.deletedAt == nil
        }
        return (try? context.fetch(descriptor)) ?? []
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
        try? context.save()
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

        guard let upload = try? context.fetch(uploadDescriptor).first else { return }

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

        try? context.save()
    }

    func markFailed(uploadId: String, error: String) {
        var descriptor = FetchDescriptor<AttachmentUpload>()
        descriptor.predicate = #Predicate { $0.id == uploadId }
        descriptor.fetchLimit = 1

        guard let upload = try? context.fetch(descriptor).first else { return }

        upload.stage = AttachmentUploadStage.failed.rawValue
        upload.error = error
        upload.retryCount += 1

        try? context.save()
    }
}
