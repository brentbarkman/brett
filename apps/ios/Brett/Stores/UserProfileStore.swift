import Foundation
import Observation
import SwiftData

/// Singleton user profile. Populated from `/users/me` at boot and after
/// settings mutations. Not synced through the mutation queue — settings
/// flow through their own endpoints that mutate and return fresh profile data.
@MainActor
@Observable
final class UserProfileStore {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    convenience init() {
        self.init(context: PersistenceController.shared.mainContext)
    }

    /// Currently cached profile, if we have one.
    var current: UserProfile? {
        var descriptor = FetchDescriptor<UserProfile>()
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    /// Replace the cached profile with fresh values.
    ///
    /// `update(from:)` is called with a dictionary decoded from `/users/me`
    /// — we keep it loose here rather than coupling to a concrete `AuthUser`
    /// type (which lives in the auth package).
    func update(from payload: [String: Any]) {
        guard let id = payload["id"] as? String, let email = payload["email"] as? String else { return }

        let profile: UserProfile
        if let existing = current {
            profile = existing
            profile.email = email
        } else {
            profile = UserProfile(id: id, email: email)
            context.insert(profile)
        }

        profile.id = id
        profile.email = email
        profile.name = payload["name"] as? String
        profile.avatarUrl = (payload["image"] as? String) ?? (payload["avatarUrl"] as? String)

        if let assistantName = payload["assistantName"] as? String { profile.assistantName = assistantName }
        if let timezone = payload["timezone"] as? String { profile.timezone = timezone }
        if let timezoneAuto = payload["timezoneAuto"] as? Bool { profile.timezoneAuto = timezoneAuto }

        profile.city = payload["city"] as? String
        profile.countryCode = payload["countryCode"] as? String

        if let tempUnit = payload["tempUnit"] as? String { profile.tempUnit = tempUnit }
        if let weatherEnabled = payload["weatherEnabled"] as? Bool { profile.weatherEnabled = weatherEnabled }

        if let backgroundStyle = payload["backgroundStyle"] as? String { profile.backgroundStyle = backgroundStyle }
        profile.pinnedBackground = payload["pinnedBackground"] as? String

        profile.avgBusynessScore = payload["avgBusynessScore"] as? Double

        profile.updatedAt = Date()

        try? context.save()
    }

    func clear() {
        guard let existing = current else { return }
        context.delete(existing)
        try? context.save()
    }
}
