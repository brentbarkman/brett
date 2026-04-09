import Foundation
import SwiftData

@Model
final class ItemList {
    @Attribute(.unique) var id: String
    var name: String
    var colorClass: String = "bg-gray-500"
    var sortOrder: Int = 0
    var archivedAt: Date?
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    // Sync metadata
    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?
    var lastError: String?

    init(id: String = UUID().uuidString, name: String, colorClass: String = "bg-gray-500", userId: String) {
        self.id = id
        self.name = name
        self.colorClass = colorClass
        self.userId = userId
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
