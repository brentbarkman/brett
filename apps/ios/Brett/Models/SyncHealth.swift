import Foundation
import SwiftData

/// Mirrors `_sync_health`. Singleton row (id = "singleton") tracking the
/// health of the sync engine — used by the UI to show dot indicators,
/// warning banners, etc.
@Model
final class SyncHealth {
    @Attribute(.unique) var id: String

    var lastSuccessfulPushAt: Date?
    var lastSuccessfulPullAt: Date?

    var pendingMutationCount: Int = 0
    var deadMutationCount: Int = 0

    var isPushing: Bool = false
    var isPulling: Bool = false

    var lastError: String?
    var consecutiveFailures: Int = 0

    init(id: String = "singleton") {
        self.id = id
    }
}
