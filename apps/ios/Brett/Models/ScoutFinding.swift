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

// MARK: - Codable (sync wire format)
//
// Encoding/decoding is asymmetric on purpose: outbound payloads
// (`encode(to:)`) intentionally OMIT `deletedAt` to match the legacy
// `toServerPayload(_ finding:)` shape — the server treats deletes via the
// global `/sync/push` `deletes[]` envelope, not a per-row tombstone.
// Inbound (`init(from:)`) DOES read `deletedAt` so hydration from
// `/sync/pull` survives soft-deleted rows.
//
// Reserved-word remap: the model property `findingDescription` maps to the
// wire key `description`. Swift can't have a stored property literally named
// `description` (NSObject's `CustomStringConvertible` reserves it as a
// computed property), so the model column stays `findingDescription` and
// the `CodingKeys` raw value bridges the two.
//
// Nullable fields are encoded as explicit JSON `null` via `encode`
// (NOT `encodeIfPresent`) so the wire shape stays byte-compatible with
// the legacy mapper, which emitted `NSNull()` for missing values rather
// than dropping the key.
//
// Sync-metadata fields (`_syncStatus`, `_baseUpdatedAt`, `_lastError`)
// are deliberately excluded from both directions: they are local-only
// state and must not be round-tripped through the server.
extension ScoutFinding: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case scoutId
        case scoutRunId
        case type
        case title
        case findingDescription = "description"
        case sourceUrl
        case sourceName
        case relevanceScore
        case reasoning
        case itemId
        case feedbackUseful
        case feedbackAt
        case createdAt
        case updatedAt
        case deletedAt
    }

    public convenience init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let scoutId = try container.decode(String.self, forKey: .scoutId)
        let scoutRunId = try container.decodeIfPresent(String.self, forKey: .scoutRunId)
        let typeStr = try container.decodeIfPresent(String.self, forKey: .type) ?? ""
        let type = FindingType(rawValue: typeStr) ?? .insight
        let title = try container.decode(String.self, forKey: .title)
        let findingDescription = try container.decode(String.self, forKey: .findingDescription)
        let sourceName = try container.decode(String.self, forKey: .sourceName)
        let sourceUrl = try container.decodeIfPresent(String.self, forKey: .sourceUrl)
        let relevanceScore = try container.decodeIfPresent(Double.self, forKey: .relevanceScore)
        let reasoning = try container.decodeIfPresent(String.self, forKey: .reasoning) ?? ""
        let createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        let updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()

        self.init(
            id: id,
            scoutId: scoutId,
            scoutRunId: scoutRunId,
            type: type,
            title: title,
            description: findingDescription,
            sourceName: sourceName,
            sourceUrl: sourceUrl,
            relevanceScore: relevanceScore,
            reasoning: reasoning,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
        self.itemId = try container.decodeIfPresent(String.self, forKey: .itemId)
        self.feedbackUseful = try container.decodeIfPresent(Bool.self, forKey: .feedbackUseful)
        self.feedbackAt = try container.decodeIfPresent(Date.self, forKey: .feedbackAt)
        self.deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(scoutId, forKey: .scoutId)
        try container.encode(type, forKey: .type)
        try container.encode(title, forKey: .title)
        try container.encode(findingDescription, forKey: .findingDescription)
        try container.encode(sourceName, forKey: .sourceName)
        try container.encode(reasoning, forKey: .reasoning)
        // Use `encode` (not `encodeIfPresent`) for nullable fields so nil
        // becomes JSON `null` on the wire — matches legacy NSNull behavior.
        try container.encode(scoutRunId, forKey: .scoutRunId)
        try container.encode(sourceUrl, forKey: .sourceUrl)
        try container.encode(relevanceScore, forKey: .relevanceScore)
        try container.encode(itemId, forKey: .itemId)
        try container.encode(feedbackUseful, forKey: .feedbackUseful)
        try container.encode(feedbackAt, forKey: .feedbackAt)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        // Note: `deletedAt` is intentionally NOT encoded — the legacy
        // `toServerPayload(_ finding:)` did not include it on the wire.
    }
}
