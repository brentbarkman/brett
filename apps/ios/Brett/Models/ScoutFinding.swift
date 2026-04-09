import Foundation
import SwiftData

@Model
final class ScoutFinding {
    @Attribute(.unique) var id: String
    var scoutId: String
    var type: String   // FindingType raw value
    var title: String
    var findingDescription: String
    var sourceUrl: String?
    var sourceName: String
    var relevanceScore: Double
    var reasoning: String
    var feedbackUseful: Bool?
    var itemId: String?
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?

    init(
        id: String = UUID().uuidString,
        scoutId: String,
        type: FindingType = .insight,
        title: String,
        description: String,
        sourceName: String,
        relevanceScore: Double = 0.8,
        reasoning: String = ""
    ) {
        self.id = id
        self.scoutId = scoutId
        self.type = type.rawValue
        self.title = title
        self.findingDescription = description
        self.sourceName = sourceName
        self.relevanceScore = relevanceScore
        self.reasoning = reasoning
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
