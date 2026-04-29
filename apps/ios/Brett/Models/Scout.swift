import Foundation
import SwiftData

/// Mirrors Prisma `Scout`. Cadence tracks how often it runs; budget limits total spend.
@Model
final class Scout {
    @Attribute(.unique) var id: String
    var userId: String

    // Presentation
    var name: String
    var avatarLetter: String = ""
    var avatarGradientFrom: String = ""
    var avatarGradientTo: String = ""

    // Behaviour
    var goal: String
    var context: String?
    var sourcesJSON: String?          // JSON: [{ name, url? }]

    var sensitivity: String = ScoutSensitivity.medium.rawValue
    var analysisTier: String = AnalysisTier.standard.rawValue

    // Cadence
    var cadenceIntervalHours: Double
    var cadenceMinIntervalHours: Double = 1
    var cadenceCurrentIntervalHours: Double = 24
    var cadenceReason: String?

    // Budget
    var budgetTotal: Int
    var budgetUsed: Int = 0
    var budgetResetAt: Date?

    // Status
    var status: String = ScoutStatus.active.rawValue
    var statusLine: String?
    var bootstrapped: Bool = false
    var endDate: Date?
    var nextRunAt: Date?
    var lastRun: Date?

    // Server-computed denormalized count of non-deleted findings tied to
    // this scout. Mirrors `ScoutDTO.findingsCount` so roster cards can
    // render a count badge without a per-row `@Query<ScoutFinding>`.
    // Default 0 keeps existing rows valid through the migration.
    var findingsCount: Int = 0

    // Timestamps
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
        goal: String,
        context: String? = nil,
        cadenceIntervalHours: Double = 24,
        budgetTotal: Int = 100,
        sensitivity: ScoutSensitivity = .medium,
        analysisTier: AnalysisTier = .standard,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.userId = userId
        self.name = name
        self.goal = goal
        self.context = context
        self.cadenceIntervalHours = cadenceIntervalHours
        self.cadenceCurrentIntervalHours = cadenceIntervalHours
        self.budgetTotal = budgetTotal
        self.sensitivity = sensitivity.rawValue
        self.analysisTier = analysisTier.rawValue
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    // MARK: - Typed helpers
    var scoutStatus: ScoutStatus { ScoutStatus(rawValue: status) ?? .active }
    var scoutSensitivity: ScoutSensitivity { ScoutSensitivity(rawValue: sensitivity) ?? .medium }
    var scoutAnalysisTier: AnalysisTier { AnalysisTier(rawValue: analysisTier) ?? .standard }

    /// Convenience: rebuild the two-stop gradient as the wire-format array
    /// (`[from, to]`) so views can pass it straight to `ScoutAvatar`. Mirrors
    /// `ScoutDTO.avatarGradient`.
    var avatarGradient: [String] {
        [avatarGradientFrom, avatarGradientTo]
    }

    var syncStatusEnum: SyncStatus {
        SyncStatus(rawValue: _syncStatus) ?? .synced
    }

    /// Decoded source list — safe on missing/invalid JSON.
    var sources: [[String: Any]] {
        guard let data = sourcesJSON?.data(using: .utf8) else { return [] }
        return (try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
    }
}

// MARK: - Codable (sync wire format)
//
// Encoding/decoding is asymmetric on purpose: outbound payloads
// (`encode(to:)`) intentionally OMIT `deletedAt` to match the legacy
// `toServerPayload(_ scout:)` shape — the server treats deletes via the
// global `/sync/push` `deletes[]` envelope, not a per-row tombstone.
// Inbound (`init(from:)`) DOES read `deletedAt` so hydration from
// `/sync/pull` survives soft-deleted rows.
//
// JSON-blob field `sourcesJSON` ↔ wire key `sources`: at this Codable
// layer we treat `sources` as a `String?` (the model column form). The
// `SyncEntityMapper` shims handle the wire-format transform — post-encode
// the string is re-parsed into a JSON dict/array; pre-decode the wire's
// dict/array is stringified — so this Codable contract stays simple.
//
// Server-computed / inbound-only fields NOT included in `CodingKeys`
// (matches legacy mapper byte-for-byte):
//   • `findingsCount` — server-denormalized count, never sent on push
//     and not applied by `applyScoutFields`.
//   • `lastRun` — server-managed, not applied by `applyScoutFields`.
//
// Nullable fields are encoded as explicit JSON `null` via `encode`
// (NOT `encodeIfPresent`) so the wire shape stays byte-compatible with
// the legacy mapper, which emitted `NSNull()` for missing values rather
// than dropping the key.
//
// Sync-metadata fields (`_syncStatus`, `_baseUpdatedAt`, `_lastError`)
// are deliberately excluded from both directions: they are local-only
// state and must not be round-tripped through the server.
extension Scout: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case userId
        case name
        case avatarLetter
        case avatarGradientFrom
        case avatarGradientTo
        case goal
        case context
        case sourcesJSON = "sources"
        case sensitivity
        case analysisTier
        case cadenceIntervalHours
        case cadenceMinIntervalHours
        case cadenceCurrentIntervalHours
        case cadenceReason
        case budgetTotal
        case budgetUsed
        case budgetResetAt
        case status
        case statusLine
        case bootstrapped
        case endDate
        case nextRunAt
        case createdAt
        case updatedAt
        case deletedAt
    }

    public convenience init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let userId = try container.decode(String.self, forKey: .userId)
        let name = try container.decode(String.self, forKey: .name)
        let goal = try container.decode(String.self, forKey: .goal)
        let context = try container.decodeIfPresent(String.self, forKey: .context)
        let cadenceIntervalHours = try container.decodeIfPresent(Double.self, forKey: .cadenceIntervalHours) ?? 24
        let budgetTotal = try container.decodeIfPresent(Int.self, forKey: .budgetTotal) ?? 100
        let sensitivityStr = try container.decodeIfPresent(String.self, forKey: .sensitivity) ?? ""
        let sensitivity = ScoutSensitivity(rawValue: sensitivityStr) ?? .medium
        let analysisTierStr = try container.decodeIfPresent(String.self, forKey: .analysisTier) ?? ""
        let analysisTier = AnalysisTier(rawValue: analysisTierStr) ?? .standard
        let createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        let updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date()

        self.init(
            id: id,
            userId: userId,
            name: name,
            goal: goal,
            context: context,
            cadenceIntervalHours: cadenceIntervalHours,
            budgetTotal: budgetTotal,
            sensitivity: sensitivity,
            analysisTier: analysisTier,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
        // Apply remaining fields not handled by the convenience initializer.
        if let v = try container.decodeIfPresent(String.self, forKey: .avatarLetter) { self.avatarLetter = v }
        if let v = try container.decodeIfPresent(String.self, forKey: .avatarGradientFrom) { self.avatarGradientFrom = v }
        if let v = try container.decodeIfPresent(String.self, forKey: .avatarGradientTo) { self.avatarGradientTo = v }
        self.sourcesJSON = try container.decodeIfPresent(String.self, forKey: .sourcesJSON)
        if let v = try container.decodeIfPresent(Double.self, forKey: .cadenceMinIntervalHours) { self.cadenceMinIntervalHours = v }
        if let v = try container.decodeIfPresent(Double.self, forKey: .cadenceCurrentIntervalHours) { self.cadenceCurrentIntervalHours = v }
        self.cadenceReason = try container.decodeIfPresent(String.self, forKey: .cadenceReason)
        if let v = try container.decodeIfPresent(Int.self, forKey: .budgetUsed) { self.budgetUsed = v }
        self.budgetResetAt = try container.decodeIfPresent(Date.self, forKey: .budgetResetAt)
        if let v = try container.decodeIfPresent(String.self, forKey: .status) { self.status = v }
        self.statusLine = try container.decodeIfPresent(String.self, forKey: .statusLine)
        if let v = try container.decodeIfPresent(Bool.self, forKey: .bootstrapped) { self.bootstrapped = v }
        self.endDate = try container.decodeIfPresent(Date.self, forKey: .endDate)
        self.nextRunAt = try container.decodeIfPresent(Date.self, forKey: .nextRunAt)
        self.deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(userId, forKey: .userId)
        try container.encode(name, forKey: .name)
        try container.encode(avatarLetter, forKey: .avatarLetter)
        try container.encode(avatarGradientFrom, forKey: .avatarGradientFrom)
        try container.encode(avatarGradientTo, forKey: .avatarGradientTo)
        try container.encode(goal, forKey: .goal)
        try container.encode(sensitivity, forKey: .sensitivity)
        try container.encode(analysisTier, forKey: .analysisTier)
        try container.encode(cadenceIntervalHours, forKey: .cadenceIntervalHours)
        try container.encode(cadenceMinIntervalHours, forKey: .cadenceMinIntervalHours)
        try container.encode(cadenceCurrentIntervalHours, forKey: .cadenceCurrentIntervalHours)
        try container.encode(budgetTotal, forKey: .budgetTotal)
        try container.encode(budgetUsed, forKey: .budgetUsed)
        try container.encode(status, forKey: .status)
        try container.encode(bootstrapped, forKey: .bootstrapped)
        // Use `encode` (not `encodeIfPresent`) for nullable fields so nil
        // becomes JSON `null` on the wire — matches legacy NSNull behavior.
        try container.encode(context, forKey: .context)
        // `sourcesJSON` is encoded here as a String (or JSON null). The
        // `SyncEntityMapper` shim post-processes the encoded payload to
        // re-parse the string back into a JSON dict/array on the wire.
        try container.encode(sourcesJSON, forKey: .sourcesJSON)
        try container.encode(cadenceReason, forKey: .cadenceReason)
        try container.encode(budgetResetAt, forKey: .budgetResetAt)
        try container.encode(statusLine, forKey: .statusLine)
        try container.encode(endDate, forKey: .endDate)
        try container.encode(nextRunAt, forKey: .nextRunAt)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        // Note: `deletedAt` is intentionally NOT encoded — the legacy
        // `toServerPayload(_ scout:)` did not include it on the wire.
        // Note: `findingsCount` and `lastRun` are server-managed and not
        // round-tripped — they're absent from `CodingKeys`.
    }
}
