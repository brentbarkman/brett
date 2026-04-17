import Foundation
import SwiftData

/// Mirrors the subset of Prisma `User` that the mobile app needs.
/// Singleton — only one row. Populated from `/users/me`; NOT bidirectionally synced
/// through the mutation queue (settings flow through their own endpoints).
@Model
final class UserProfile {
    @Attribute(.unique) var id: String

    var email: String
    var name: String?
    var avatarUrl: String?

    var assistantName: String = "Brett"

    var timezone: String = "America/Los_Angeles"
    var timezoneAuto: Bool = true

    var city: String?
    var countryCode: String?

    var tempUnit: String = TempUnit.auto.rawValue
    var weatherEnabled: Bool = true

    var backgroundStyle: String = BackgroundStyle.photography.rawValue
    var pinnedBackground: String?

    var avgBusynessScore: Double?

    var createdAt: Date
    var updatedAt: Date

    init(
        id: String,
        email: String,
        name: String? = nil,
        avatarUrl: String? = nil,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.email = email
        self.name = name
        self.avatarUrl = avatarUrl
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    var tempUnitEnum: TempUnit { TempUnit(rawValue: tempUnit) ?? .auto }
    var backgroundStyleEnum: BackgroundStyle { BackgroundStyle(rawValue: backgroundStyle) ?? .photography }
}
