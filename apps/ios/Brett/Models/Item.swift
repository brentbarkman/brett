import Foundation
import SwiftData

@Model
final class Item {
    @Attribute(.unique) var id: String
    var type: String = "task"        // ItemType raw value
    var status: String = "active"    // ItemStatus raw value
    var title: String
    var itemDescription: String?     // `description` is reserved in Swift
    var notes: String?
    var source: String = "Brett"
    var sourceId: String?
    var sourceUrl: String?
    var dueDate: Date?
    var dueDatePrecision: String?
    var completedAt: Date?
    var snoozedUntil: Date?
    var brettObservation: String?
    var reminder: String?
    var recurrence: String?
    var recurrenceRule: String?
    var listId: String?
    var contentType: String?
    var contentStatus: String?
    var contentTitle: String?
    var contentBody: String?
    var contentDescription: String?
    var contentImageUrl: String?
    var contentFavicon: String?
    var contentDomain: String?
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    // Sync metadata
    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?
    var lastError: String?

    init(
        id: String = UUID().uuidString,
        type: ItemType = .task,
        status: ItemStatus = .active,
        title: String,
        userId: String,
        dueDate: Date? = nil,
        listId: String? = nil,
        notes: String? = nil
    ) {
        self.id = id
        self.type = type.rawValue
        self.status = status.rawValue
        self.title = title
        self.userId = userId
        self.dueDate = dueDate
        self.listId = listId
        self.notes = notes
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    // Computed helpers
    var itemType: ItemType { ItemType(rawValue: type) ?? .task }
    var itemStatus: ItemStatus { ItemStatus(rawValue: status) ?? .active }
    var isCompleted: Bool { itemStatus == .done }
}
