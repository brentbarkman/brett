import Foundation
import SwiftData

/// Mirrors `_attachment_uploads` (spec §2.2). Tracks an in-flight S3 upload
/// for an attachment — presigned-URL request, PUT upload, server confirmation.
@Model
final class AttachmentUpload {
    @Attribute(.unique) var id: String

    var itemId: String
    var localFilePath: String
    var filename: String
    var mimeType: String
    var sizeBytes: Int

    /// AttachmentUploadStage raw value.
    var stage: String = AttachmentUploadStage.pending.rawValue

    var presignedUrl: String?
    var storageKey: String?

    var uploadProgress: Double = 0     // 0.0 to 1.0

    var error: String?
    var retryCount: Int = 0

    var createdAt: Date

    init(
        id: String = UUID().uuidString,
        itemId: String,
        localFilePath: String,
        filename: String,
        mimeType: String,
        sizeBytes: Int,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.itemId = itemId
        self.localFilePath = localFilePath
        self.filename = filename
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
        self.createdAt = createdAt
    }

    var stageEnum: AttachmentUploadStage {
        AttachmentUploadStage(rawValue: stage) ?? .pending
    }
}
