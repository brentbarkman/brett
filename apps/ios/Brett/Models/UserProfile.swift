import Foundation
import SwiftData

@Model
final class UserProfile {
    @Attribute(.unique) var id: String
    var email: String
    var name: String
    var avatarUrl: String?
    var assistantName: String = "Brett"
    var timezone: String = "America/Los_Angeles"
    var city: String?
    var countryCode: String?
    var tempUnit: String = "auto"
    var weatherEnabled: Bool = true
    var backgroundStyle: String = "photography"
    var updatedAt: Date

    init(id: String, email: String, name: String) {
        self.id = id
        self.email = email
        self.name = name
        self.updatedAt = Date()
    }
}
