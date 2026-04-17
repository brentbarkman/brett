import Foundation
import SwiftData

/// Mirrors `_sync_cursors`. One row per table the pull engine tracks.
@Model
final class SyncCursor {
    /// Primary key — canonical table name (eg "items", "lists").
    @Attribute(.unique) var tableName: String

    /// ISO-8601 server timestamp of the last successful pull for this table.
    var lastSyncedAt: String?

    var isInitialSyncComplete: Bool = false

    init(tableName: String, lastSyncedAt: String? = nil, isInitialSyncComplete: Bool = false) {
        self.tableName = tableName
        self.lastSyncedAt = lastSyncedAt
        self.isInitialSyncComplete = isInitialSyncComplete
    }
}
