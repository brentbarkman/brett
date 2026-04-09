import Foundation
import SwiftData

@Model
final class Scout {
    @Attribute(.unique) var id: String
    var name: String
    var goal: String
    var context: String?
    var sourcesJSON: String?   // JSON array of { name, url? }
    var sensitivity: String = "medium"
    var analysisTier: String = "standard"
    var cadenceIntervalHours: Double
    var budgetUsed: Int = 0
    var budgetTotal: Int
    var status: String = "active"
    var statusLine: String?
    var nextRunAt: Date?
    var userId: String
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    var syncStatus: String = "synced"
    var baseUpdatedAt: Date?

    init(
        id: String = UUID().uuidString,
        name: String,
        goal: String,
        cadenceIntervalHours: Double = 24,
        budgetTotal: Int = 100,
        userId: String
    ) {
        self.id = id
        self.name = name
        self.goal = goal
        self.cadenceIntervalHours = cadenceIntervalHours
        self.budgetTotal = budgetTotal
        self.userId = userId
        self.createdAt = Date()
        self.updatedAt = Date()
    }

    var scoutStatus: ScoutStatus { ScoutStatus(rawValue: status) ?? .active }
}
