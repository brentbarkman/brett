import Foundation

/// Matches the response shape of `GET /users/me`. Used as the in-memory
/// representation of the signed-in user. Persistent user data lives in the
/// `UserProfile` SwiftData model (owned by another agent) — this struct is
/// only for auth/session state.
struct AuthUser: Codable, Equatable, Sendable {
    let id: String
    let email: String
    let name: String?
    let avatarUrl: String?
    let timezone: String?
    let assistantName: String?

    init(
        id: String,
        email: String,
        name: String? = nil,
        avatarUrl: String? = nil,
        timezone: String? = nil,
        assistantName: String? = nil
    ) {
        self.id = id
        self.email = email
        self.name = name
        self.avatarUrl = avatarUrl
        self.timezone = timezone
        self.assistantName = assistantName
    }

    // Tolerate extra fields returned by /users/me (e.g. city, countryCode,
    // tempUnit, weatherEnabled, etc.) — we only decode the ones we use here.
    enum CodingKeys: String, CodingKey {
        case id
        case email
        case name
        case avatarUrl
        case timezone
        case assistantName
    }
}

/// The result of a successful sign-in: an opaque bearer token + the hydrated
/// user profile. Providers return this; AuthManager persists the token in
/// Keychain and hydrates `currentUser` from the embedded `AuthUser`.
struct AuthSession: Sendable {
    let token: String
    let user: AuthUser
}
