import Foundation
import SwiftData

@Model
final class Attachment {
    @Attribute(.unique) var id: String
    var filename: String
    var mimeType: String
    var sizeBytes: Int
    var storageKey: String
    var url: String?
    var itemId: String
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?

    init(id: String = UUID().uuidString, filename: String, mimeType: String, sizeBytes: Int, storageKey: String, itemId: String, userId: String) {
        self.id = id
        self.filename = filename
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
        self.storageKey = storageKey
        self.itemId = itemId
        self.userId = userId
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
