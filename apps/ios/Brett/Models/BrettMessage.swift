import Foundation
import SwiftData

@Model
final class BrettMessage {
    @Attribute(.unique) var id: String
    var itemId: String?
    var calendarEventId: String?
    var role: String  // "user" or "brett"
    var content: String
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?

    init(id: String = UUID().uuidString, role: String, content: String, userId: String, itemId: String? = nil, calendarEventId: String? = nil) {
        self.id = id
        self.role = role
        self.content = content
        self.userId = userId
        self.itemId = itemId
        self.calendarEventId = calendarEventId
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
