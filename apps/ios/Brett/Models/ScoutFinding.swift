import Foundation
import SwiftData

/// Mirrors Prisma `ScoutFinding`.
@Model
final class ScoutFinding {
    @Attribute(.unique) var id: String

    var scoutId: String
    var scoutRunId: String?          // Mobile sync may lag on runs; optional here

    var type: String                 // FindingType raw value
    var title: String
    var findingDescription: String   // Prisma: description (reserved-ish)
    var sourceUrl: String?
    var sourceName: String
    var relevanceScore: Double?
    var reasoning: String

    var itemId: String?              // if finding spawned a task/content item
    var feedbackUseful: Bool?
    var feedbackAt: Date?

    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    // Sync metadata
    var _syncStatus: String = SyncStatus.synced.rawValue
    var _baseUpdatedAt: String?
    var _lastError: String?

    init(
        id: String = UUID().uuidString,
        scoutId: String,
        scoutRunId: String? = nil,
        type: FindingType = .insight,
        title: String,
        description: String,
        sourceName: String,
        sourceUrl: String? = nil,
        relevanceScore: Double? = 0.8,
        reasoning: String = "",
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.scoutId = scoutId
        self.scoutRunId = scoutRunId
        self.type = type.rawValue
        self.title = title
        self.findingDescription = description
        self.sourceName = sourceName
        self.sourceUrl = sourceUrl
        self.relevanceScore = relevanceScore
        self.reasoning = reasoning
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    var findingType: FindingType { FindingType(rawValue: type) ?? .insight }

    var syncStatusEnum: SyncStatus {
        SyncStatus(rawValue: _syncStatus) ?? .synced
    }
}
