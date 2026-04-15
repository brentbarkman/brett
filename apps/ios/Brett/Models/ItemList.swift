import Foundation
import SwiftData

/// Mirrors Prisma `List`. Named `ItemList` because `List` collides with SwiftUI.
@Model
final class ItemList {
    @Attribute(.unique) var id: String
    var userId: String

    var name: String
    var colorClass: String = "bg-gray-500"
    var sortOrder: Int = 0
    var archivedAt: Date?

    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    // Sync metadata
    var _syncStatus: String = SyncStatus.synced.rawValue
    var _baseUpdatedAt: String?
    var _lastError: String?

    init(
        id: String = UUID().uuidString,
        userId: String,
        name: String,
        colorClass: String = "bg-gray-500",
        sortOrder: Int = 0,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.userId = userId
        self.name = name
        self.colorClass = colorClass
        self.sortOrder = sortOrder
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    var syncStatusEnum: SyncStatus {
        SyncStatus(rawValue: _syncStatus) ?? .synced
    }

    var isArchived: Bool { archivedAt != nil }
}
