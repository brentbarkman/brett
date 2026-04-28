import Foundation
import Observation
import SwiftData

/// Singleton user profile. Populated from `/users/me` at boot and after
/// settings mutations. Not synced through the mutation queue — settings
/// flow through their own endpoints that mutate and return fresh profile data.
///
/// Mutation-only: views read the profile via `@Query<UserProfile>` directly
/// against SwiftData (the canonical store). This type owns the write paths
/// — `update(from:)` upserts a row from a `/users/me` payload, and
/// `refresh(client:)` is the network entry point that wraps it.
@MainActor
@Observable
final class UserProfileStore: Clearable {
    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
        ClearableStoreRegistry.register(self)
    }

    convenience init() {
        self.init(context: PersistenceController.shared.mainContext)
    }

    // MARK: - Clearable

    /// No in-memory state to drop — the SwiftData row is wiped by
    /// `PersistenceController.wipeAllData()` on sign-out, and views
    /// read live via `@Query`. Kept on `Clearable` for protocol
    /// conformance and so future observable state has a hook.
    func clearForSignOut() {}

    /// Upsert the local `UserProfile` row from a `/users/me` payload.
    ///
    /// `update(from:)` is called with a dictionary decoded from `/users/me`
    /// — we keep it loose here rather than coupling to a concrete `AuthUser`
    /// type (which lives in the auth package).
    func update(from payload: [String: Any]) {
        guard let id = payload["id"] as? String, let email = payload["email"] as? String else { return }

        // Resolve the row exactly once via direct fetch. Two consecutive
        // update calls that both fall through to the "insert" branch
        // would otherwise leave duplicate rows in SwiftData.
        var descriptor = FetchDescriptor<UserProfile>(
            predicate: #Predicate { profile in
                profile.id == id
            }
        )
        descriptor.fetchLimit = 1
        let existing = try? context.fetch(descriptor).first

        let profile: UserProfile
        if let existing {
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

        save()
    }

    private func save() {
        do {
            try context.save()
        } catch {
            BrettLog.store.error("UserProfileStore save failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// Fetch `/users/me` and hydrate the local cache.
    ///
    /// Nothing populates the store on cold launch — it's only written by the
    /// settings screens that edit a field. That meant a brand-new install
    /// would open Settings and see `email: "—"` because `current` was nil
    /// and `AuthManager.currentUser` hadn't necessarily refreshed yet.
    /// Call this from any settings screen that displays profile fields.
    func refresh(client: APIClient = .shared) async {
        struct MeResponse: Decodable {
            let id: String
            let email: String
            let name: String?
            let avatarUrl: String?
            let assistantName: String?
            let timezone: String?
            let timezoneAuto: Bool?
            let city: String?
            let countryCode: String?
            let tempUnit: String?
            let weatherEnabled: Bool?
            let backgroundStyle: String?
            let pinnedBackground: String?
            let avgBusynessScore: Double?
        }

        do {
            let me: MeResponse = try await client.request(
                path: "/users/me",
                method: "GET"
            )
            var payload: [String: Any] = [
                "id": me.id,
                "email": me.email,
            ]
            if let n = me.name { payload["name"] = n }
            if let a = me.avatarUrl { payload["avatarUrl"] = a }
            if let an = me.assistantName { payload["assistantName"] = an }
            if let tz = me.timezone { payload["timezone"] = tz }
            if let tza = me.timezoneAuto { payload["timezoneAuto"] = tza }
            if let c = me.city { payload["city"] = c }
            if let cc = me.countryCode { payload["countryCode"] = cc }
            if let tu = me.tempUnit { payload["tempUnit"] = tu }
            if let we = me.weatherEnabled { payload["weatherEnabled"] = we }
            if let bs = me.backgroundStyle { payload["backgroundStyle"] = bs }
            payload["pinnedBackground"] = me.pinnedBackground as Any
            if let abs = me.avgBusynessScore { payload["avgBusynessScore"] = abs }
            update(from: payload)
        } catch {
            // Transient network / 401 — leave existing profile in place so
            // the UI doesn't flicker out. AuthManager handles real 401s
            // (zombie token → sign out) on its own refresh path.
        }
    }
}
