import Foundation
import SwiftData

/// Mirrors Prisma `BrettMessage`. Each message is scoped to an item or a calendar event.
@Model
final class BrettMessage {
    @Attribute(.unique) var id: String

    var userId: String
    var itemId: String?
    var calendarEventId: String?

    var role: String                // MessageRole raw value
    var content: String

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
        role: MessageRole,
        content: String,
        itemId: String? = nil,
        calendarEventId: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.userId = userId
        self.role = role.rawValue
        self.content = content
        self.itemId = itemId
        self.calendarEventId = calendarEventId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    var messageRole: MessageRole { MessageRole(rawValue: role) ?? .user }

    var syncStatusEnum: SyncStatus {
        SyncStatus(rawValue: _syncStatus) ?? .synced
    }
}
