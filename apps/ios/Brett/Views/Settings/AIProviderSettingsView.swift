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

    // Usage stats
    @State private var usageSummary: UsageSummary?
    @State private var expandedPeriod: UsageTimePeriod?

    // Token usage display preference
    @AppStorage("ai.showTokenUsage") private var showTokenUsage: Bool = false

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

            // MARK: Token usage toggle

            BrettSettingsSection {
                Toggle(isOn: $showTokenUsage) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Show token usage in conversations")
                            .font(BrettTypography.taskTitle)
                            .foregroundStyle(BrettColors.textCardTitle)
                        Text("Display token counts on AI messages")
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)
                    }
                }
                .tint(BrettColors.gold)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }

            // MARK: Configured providers

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

            // MARK: Add key

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

            // MARK: Usage stats

            BrettSettingsSection("Usage") {
                if let summary = usageSummary {
                    usagePeriodRow(.last24h, periods: summary.last24h)
                    BrettSettingsDivider()
                    usagePeriodRow(.last7d, periods: summary.last7d)
                    BrettSettingsDivider()
                    usagePeriodRow(.last30d, periods: summary.last30d)
                } else {
                    HStack {
                        Spacer()
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(BrettColors.gold)
                        Spacer()
                    }
                    .padding(.vertical, 12)
                }
            }
        }
        .navigationTitle("AI Providers")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { await refresh() }
        .task { await fetchUsage() }
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

    // MARK: - Usage period rows

    @ViewBuilder
    private func usagePeriodRow(_ period: UsageTimePeriod, periods: [UsagePeriod]) -> some View {
        let totalCalls = periods.reduce(0) { $0 + $1.calls }
        let totalTokens = periods.reduce(0) { $0 + $1.inputTokens + $1.outputTokens }
        let isExpanded = expandedPeriod == period

        VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    expandedPeriod = isExpanded ? nil : period
                }
            } label: {
                HStack {
                    Text(period.label)
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(BrettColors.textCardTitle)
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(totalCalls) calls")
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)
                        Text("\(formatTokenCount(totalTokens)) tokens")
                            .font(BrettTypography.taskMeta)
                            .foregroundStyle(BrettColors.textMeta)
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BrettColors.textMeta)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)

            if isExpanded {
                providerBreakdown(periods)
            }
        }
    }

    @ViewBuilder
    private func providerBreakdown(_ periods: [UsagePeriod]) -> some View {
        if periods.isEmpty {
            Text("No usage recorded.")
                .font(BrettTypography.taskMeta)
                .foregroundStyle(BrettColors.textMeta)
                .padding(.horizontal, 14)
                .padding(.bottom, 12)
        } else {
            // Group by provider for a cleaner breakdown
            let grouped = Dictionary(grouping: periods, by: { $0.provider })
            let sortedProviders = grouped.keys.sorted()

            ForEach(sortedProviders, id: \.self) { provider in
                if let entries = grouped[provider] {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(AIProviderOption(rawValue: provider)?.displayName ?? provider.capitalized)
                            .font(BrettTypography.badge)
                            .foregroundStyle(BrettColors.gold.opacity(0.75))

                        ForEach(entries, id: \.uniqueKey) { entry in
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(entry.model)
                                        .font(.system(size: 12, design: .monospaced))
                                        .foregroundStyle(BrettColors.textCardTitle)
                                    Text(entry.source)
                                        .font(.system(size: 11))
                                        .foregroundStyle(BrettColors.textMeta)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 1) {
                                    Text("\(entry.calls) calls")
                                        .font(BrettTypography.taskMeta)
                                        .foregroundStyle(BrettColors.textMeta)
                                    Text("\(formatTokenCount(entry.inputTokens)) in / \(formatTokenCount(entry.outputTokens)) out")
                                        .font(.system(size: 11))
                                        .foregroundStyle(BrettColors.textMeta)
                                    if entry.cacheCreationTokens > 0 || entry.cacheReadTokens > 0 {
                                        Text("cache: \(formatTokenCount(entry.cacheCreationTokens)) w / \(formatTokenCount(entry.cacheReadTokens)) r")
                                            .font(.system(size: 11))
                                            .foregroundStyle(BrettColors.textMeta.opacity(0.7))
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
                }
            }
        }
    }

    // MARK: - Token formatting

    private func formatTokenCount(_ count: Int) -> String {
        switch count {
        case 0:
            return "0"
        case 1..<1_000:
            return "\(count)"
        case 1_000..<1_000_000:
            let k = Double(count) / 1_000.0
            return k < 10 ? String(format: "%.1fK", k) : String(format: "%.0fK", k)
        default:
            let m = Double(count) / 1_000_000.0
            return m < 10 ? String(format: "%.1fM", m) : String(format: "%.0fM", m)
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

    private func fetchUsage() async {
        do {
            let summary: UsageSummary = try await client.request(
                path: "/ai/usage/summary",
                method: "GET"
            )
            usageSummary = summary
        } catch {
            // Non-critical — just leave the section in its loading/empty state.
            usageSummary = UsageSummary(last24h: [], last7d: [], last30d: [])
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

// MARK: - Usage models

struct UsageSummary: Decodable {
    let last24h: [UsagePeriod]
    let last7d: [UsagePeriod]
    let last30d: [UsagePeriod]
}

struct UsagePeriod: Decodable {
    let provider: String
    let model: String
    let source: String
    let calls: Int
    let inputTokens: Int
    let outputTokens: Int
    let cacheCreationTokens: Int
    let cacheReadTokens: Int

    /// Stable identity for ForEach — combination of provider+model+source
    /// is unique within a single time window.
    var uniqueKey: String { "\(provider):\(model):\(source)" }
}

/// Identifies which time window is expanded in the usage section.
enum UsageTimePeriod: Hashable {
    case last24h
    case last7d
    case last30d

    var label: String {
        switch self {
        case .last24h: return "Last 24 hours"
        case .last7d: return "Last 7 days"
        case .last30d: return "Last 30 days"
        }
    }
}
