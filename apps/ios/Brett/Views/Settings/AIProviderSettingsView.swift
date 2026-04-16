import SwiftUI

/// Manage the user's AI provider configuration.
///
/// Backed by `/ai/config` on the API:
/// - GET  /ai/config — list of configured providers (keys redacted)
/// - POST /ai/config — add/update a key (validates on the server)
/// - PUT  /ai/config/:id/activate — set active provider
/// - DELETE /ai/config/:id — remove a provider
///
/// The active provider powers Brett's replies. We only store the key on the
/// server (never locally) so keys can't leak through device backups.
struct AIProviderSettingsView: View {
    @State private var configs: [AIConfigEntry] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var successMessage: String?

    // New-key form
    @State private var selectedProvider: AIProviderOption = .anthropic
    @State private var newKey: String = ""
    @State private var showKey: Bool = false
    @State private var isTesting = false
    @State private var pendingDeleteId: String?

    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    var body: some View {
        BrettSettingsScroll {
            if let successMessage {
                BrettSettingsSection {
                    Text(successMessage)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.success)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                }
            }

            if let errorMessage {
                BrettSettingsSection {
                    Text(errorMessage)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.error)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                }
            }

            BrettSettingsSection("Configured Providers") {
                if configs.isEmpty, !isLoading {
                    Text("No providers configured yet.")
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                } else {
                    ForEach(Array(configs.enumerated()), id: \.element.id) { index, config in
                        if index > 0 {
                            BrettSettingsDivider()
                        }
                        providerRow(config)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                    }
                }
            }

            BrettSettingsSection("Add Key") {
                Picker("Provider", selection: $selectedProvider) {
                    ForEach(AIProviderOption.allCases) { option in
                        Text(option.displayName).tag(option)
                    }
                }
                .foregroundStyle(BrettColors.textCardTitle)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

                BrettSettingsDivider()

                HStack {
                    if showKey {
                        TextField("sk-...", text: $newKey)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .foregroundStyle(.white)
                    } else {
                        SecureField("sk-...", text: $newKey)
                            .foregroundStyle(.white)
                    }
                    Button {
                        showKey.toggle()
                    } label: {
                        Image(systemName: showKey ? "eye.slash" : "eye")
                            .foregroundStyle(BrettColors.gold)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)

                BrettSettingsDivider()

                Button {
                    Task { await saveKey() }
                } label: {
                    HStack {
                        if isTesting {
                            ProgressView().progressViewStyle(.circular).tint(BrettColors.gold)
                        } else {
                            Image(systemName: "checkmark.seal")
                                .foregroundStyle(BrettColors.gold)
                        }
                        Text(isTesting ? "Testing key..." : "Save & Activate")
                            .foregroundStyle(BrettColors.textCardTitle)
                        Spacer()
                    }
                }
                .disabled(newKey.isEmpty || isTesting)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }

            Text("Keys are validated with the provider before being saved. We never store the raw key locally.")
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.textMeta)
                .padding(.top, -16)
        }
        .navigationTitle("AI Providers")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { await refresh() }
        .confirmationDialog(
            "Remove this provider?",
            isPresented: Binding(
                get: { pendingDeleteId != nil },
                set: { if !$0 { pendingDeleteId = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                if let id = pendingDeleteId {
                    Task { await remove(id) }
                }
                pendingDeleteId = nil
            }
            Button("Cancel", role: .cancel) { pendingDeleteId = nil }
        }
    }

    // MARK: - Rows

    @ViewBuilder
    private func providerRow(_ config: AIConfigEntry) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(AIProviderOption(rawValue: config.provider)?.displayName ?? config.provider.capitalized)
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(BrettColors.textCardTitle)
                    if config.isActive {
                        Text("Active")
                            .font(BrettTypography.badgeSmall)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(BrettColors.success.opacity(0.15), in: Capsule())
                            .foregroundStyle(BrettColors.success)
                    }
                }
                Text(config.maskedKey)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(BrettColors.textMeta)
            }
            Spacer()
            if !config.isActive {
                Button("Activate") {
                    Task { await activate(config.id) }
                }
                .font(BrettTypography.badge)
                .foregroundStyle(BrettColors.gold)
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Networking

    private func refresh() async {
        isLoading = true
        defer { isLoading = false }

        struct Response: Decodable { let configs: [AIConfigEntry] }
        do {
            let response: Response = try await client.request(
                path: "/ai/config",
                method: "GET"
            )
            configs = response.configs
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "Couldn't load AI providers."
        }
    }

    private func saveKey() async {
        errorMessage = nil
        successMessage = nil
        isTesting = true
        defer { isTesting = false }

        struct Payload: Encodable { let provider: String; let apiKey: String }
        do {
            let _: AIConfigEntry = try await client.request(
                path: "/ai/config",
                method: "POST",
                body: Payload(provider: selectedProvider.rawValue, apiKey: newKey)
            )
            newKey = ""
            successMessage = "Key saved and activated."
            await refresh()
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "That key didn't work. Double-check it and try again."
        }
    }

    private func activate(_ id: String) async {
        do {
            let _: [String: Bool] = try await client.request(
                path: "/ai/config/\(id)/activate",
                method: "PUT"
            )
            await refresh()
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "Couldn't activate provider."
        }
    }

    private func remove(_ id: String) async {
        do {
            let _: [String: Bool] = try await client.request(
                path: "/ai/config/\(id)",
                method: "DELETE"
            )
            await refresh()
        } catch let apiError as APIError {
            errorMessage = apiError.userFacingMessage
        } catch {
            errorMessage = "Couldn't remove provider."
        }
    }
}

// MARK: - Models

struct AIConfigEntry: Decodable, Identifiable {
    let id: String
    let provider: String
    let isValid: Bool
    let isActive: Bool
    let maskedKey: String
}

enum AIProviderOption: String, CaseIterable, Identifiable {
    case anthropic
    case openai
    case google

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .anthropic: return "Anthropic"
        case .openai: return "OpenAI"
        case .google: return "Google"
        }
    }
}
