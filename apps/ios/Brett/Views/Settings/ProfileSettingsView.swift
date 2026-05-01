import SwiftUI
import SwiftData

/// Edit the user's display name.
///
/// Email is read-only — it lives in better-auth and can't be changed from
/// here. Avatar upload is a v2 feature; we show the gradient initial for now.
/// The assistant name lives in Timezone & Location (Personalize) alongside
/// the memory facts it's tied to — matches desktop.
///
/// Name is persisted via `PATCH /users/me`. We save eagerly on the Save
/// toolbar button so users don't lose edits if they bail out of the screen.
///
/// Outer view is a thin auth gate: the body's `@Query` predicate needs a
/// concrete `userId`, so we resolve it from `AuthManager` and remount the
/// child via `.id(userId)` whenever the active user changes.
struct ProfileSettingsView: View {
    @Environment(AuthManager.self) private var authManager

    let store: UserProfileStore
    let client: APIClient

    init(store: UserProfileStore, client: APIClient = .shared) {
        self.store = store
        self.client = client
    }

    var body: some View {
        if let userId = authManager.currentUser?.id {
            ProfileSettingsBody(userId: userId, store: store, client: client)
                .id(userId)
        } else {
            EmptyView()
        }
    }
}

private struct ProfileSettingsBody: View {
    let userId: String
    @Bindable var store: UserProfileStore

    @State private var name: String = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    @Query private var profiles: [UserProfile]
    private var currentProfile: UserProfile? { profiles.first }

    private let client: APIClient

    init(userId: String, store: UserProfileStore, client: APIClient) {
        self.userId = userId
        self.store = store
        self.client = client
        let predicate = #Predicate<UserProfile> { profile in
            profile.id == userId
        }
        _profiles = Query(filter: predicate, sort: \UserProfile.id)
    }

    var body: some View {
        BrettSettingsScroll {
            avatarSection

            BrettSettingsSection("Identity") {
                TextField("Your name", text: $name)
                    .foregroundStyle(.white)
                    .submitLabel(.done)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
            }

            BrettSettingsSection("Account") {
                HStack {
                    Text("Email")
                        .foregroundStyle(BrettColors.textMeta)
                    Spacer()
                    Text(currentProfile?.email ?? "—")
                        .foregroundStyle(BrettColors.textCardTitle)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }

            Text("Email changes aren't supported yet. Contact support if you need to move your account to a new address.")
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.textMeta)
                .padding(.top, -16)

            if let errorMessage {
                BrettSettingsSection {
                    Text(errorMessage)
                        .foregroundStyle(BrettColors.error)
                        .font(BrettTypography.taskMeta)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                }
            }
        }
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await save() }
                } label: {
                    if isSaving {
                        ProgressView().progressViewStyle(.circular).tint(BrettColors.gold)
                    } else {
                        Text("Save")
                            .foregroundStyle(BrettColors.gold)
                            .fontWeight(.semibold)
                    }
                }
                .disabled(isSaving || !hasChanges)
            }
        }
        .onAppear { hydrate() }
    }

    @ViewBuilder
    private var avatarSection: some View {
        HStack {
            Spacer()
            ZStack {
                Circle()
                    .fill(
                        // Monochrome gold fade — cerulean is reserved
                        // for Brett AI, not user avatars.
                        LinearGradient(
                            colors: [BrettColors.gold.opacity(0.45), BrettColors.gold.opacity(0.15)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 88, height: 88)
                Text(avatarInitial)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.white)
            }
            Spacer()
        }
        .padding(.vertical, 10)
    }

    private var avatarInitial: String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return String(trimmed.first.map { String($0) } ?? "B").uppercased()
    }

    private var hasChanges: Bool {
        guard let current = currentProfile else { return !name.isEmpty }
        return (current.name ?? "") != name
    }

    private func hydrate() {
        guard let profile = currentProfile else { return }
        name = profile.name ?? ""
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            struct Payload: Encodable {
                let name: String?
            }
            let payload = Payload(name: name.isEmpty ? nil : name)
            let _: [String: String] = try await client.request(
                path: "/users/me",
                method: "PATCH",
                body: payload
            )
            // Re-fetch canonical profile so the store reflects server truth.
            try? await refreshProfile()
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "Couldn't save. Please try again."
        }
    }

    private func refreshProfile() async throws {
        // Decode as a loose dictionary so we stay compatible with the
        // server's extra fields.
        struct MeResponse: Decodable {
            let id: String
            let email: String
            let name: String?
            let avatarUrl: String?
            let timezone: String?
            let timezoneAuto: Bool?
            let assistantName: String?
        }
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
        if let t = me.timezone { payload["timezone"] = t }
        if let ta = me.timezoneAuto { payload["timezoneAuto"] = ta }
        if let an = me.assistantName { payload["assistantName"] = an }
        store.update(from: payload)
    }
}
