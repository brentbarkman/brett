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
