import SwiftUI

/// Edit the user's display name + Brett's assistant name.
///
/// Email is read-only — it lives in better-auth and can't be changed
/// from here. Avatar upload is a v2 feature; we show the gradient
/// initial for now.
///
/// Name is persisted via `PATCH /users/me` (server accepts `name` and
/// `assistantName`). We save eagerly on blur / save-tap so users don't
/// lose their edits if they bail out of the screen.
struct ProfileSettingsView: View {
    @Bindable var store: UserProfileStore

    @State private var name: String = ""
    @State private var assistantName: String = "Brett"
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let client: APIClient

    init(store: UserProfileStore, client: APIClient = .shared) {
        self.store = store
        self.client = client
    }

    var body: some View {
        ZStack {
            BackgroundView()

            Form {
                avatarSection

                Section {
                    TextField("Your name", text: $name)
                        .foregroundStyle(.white)
                        .submitLabel(.done)
                        .listRowBackground(glassRowBackground)

                    TextField("Assistant name", text: $assistantName)
                        .foregroundStyle(.white)
                        .submitLabel(.done)
                        .listRowBackground(glassRowBackground)
                } header: {
                    Text("IDENTITY")
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                        .foregroundStyle(BrettColors.sectionLabelColor)
                } footer: {
                    Text("The assistant name is how Brett refers to itself. Pick anything up to 10 characters.")
                        .font(.system(size: 12))
                        .foregroundStyle(BrettColors.textMeta)
                }

                Section {
                    HStack {
                        Text("Email")
                            .foregroundStyle(BrettColors.textMeta)
                        Spacer()
                        Text(store.current?.email ?? "—")
                            .foregroundStyle(BrettColors.textCardTitle)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .listRowBackground(glassRowBackground)
                } header: {
                    Text("ACCOUNT")
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                        .foregroundStyle(BrettColors.sectionLabelColor)
                } footer: {
                    Text("Email changes aren't supported yet. Contact support if you need to move your account to a new address.")
                        .font(.system(size: 12))
                        .foregroundStyle(BrettColors.textMeta)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(BrettColors.error)
                            .font(BrettTypography.taskMeta)
                            .listRowBackground(glassRowBackground)
                    }
                }
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
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
        Section {
            HStack {
                Spacer()
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [BrettColors.gold.opacity(0.40), BrettColors.cerulean.opacity(0.30)],
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
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
        }
    }

    private var glassRowBackground: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(.thinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
            )
    }

    private var avatarInitial: String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return String(trimmed.first.map { String($0) } ?? "B").uppercased()
    }

    private var hasChanges: Bool {
        guard let current = store.current else { return !name.isEmpty }
        let currentName = current.name ?? ""
        let currentAssistant = current.assistantName
        return currentName != name || currentAssistant != assistantName
    }

    private func hydrate() {
        guard let profile = store.current else { return }
        name = profile.name ?? ""
        assistantName = profile.assistantName
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            // PATCH /users/me — the server currently validates assistantName.
            // We also send `name` optimistically; the server will ignore
            // fields it doesn't know about.
            struct Payload: Encodable {
                let name: String?
                let assistantName: String?
            }
            let payload = Payload(
                name: name.isEmpty ? nil : name,
                assistantName: assistantName.isEmpty ? nil : assistantName
            )
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
