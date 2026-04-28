import SwiftUI
import SwiftData

/// Scout detail — header, findings timeline, activity log, memory, settings.
///
/// Outer view is a thin auth gate. The body's `@Query` predicate needs a
/// concrete `userId`, so we resolve it from `AuthManager` and remount the
/// child via `.id("\(userId)-\(scoutId)")` whenever the active user OR the
/// selected scout changes. This is the standard Wave-B pattern (see
/// `TaskDetailView`, `ScoutsRosterView`).
struct ScoutDetailView: View {
    let scoutId: String

    @Environment(AuthManager.self) private var authManager

    var body: some View {
        if let userId = authManager.currentUser?.id {
            ScoutDetailBody(userId: userId, scoutId: scoutId)
                .id("\(userId)-\(scoutId)")
        } else {
            // Signed-out fallback. Upstream auth gate normally prevents this.
            EmptyView()
        }
    }
}

/// Detail's data + UI. `userId` is guaranteed non-optional for this view's
/// lifetime because the parent only renders us inside an auth check and
/// applies a composite `.id` so SwiftUI remounts on account switch OR
/// scout switch.
private struct ScoutDetailBody: View {
    let userId: String
    let scoutId: String

    @State private var scoutStore = ScoutStore()
    @State private var findings: [APIClient.FindingDTO] = []
    @State private var findingsCursor: String?
    @State private var findingsType: FindingFilter = .all
    @State private var activity: [APIClient.ActivityEntryDTO] = []
    @State private var memories: [APIClient.MemoryDTO] = []
    @State private var memoryFilter: MemoryFilter = .all
    @State private var localFeedback: [String: Bool?] = [:]
    @State private var isRunning: Bool = false
    @State private var isPresentingEdit: Bool = false
    @State private var pendingDelete: Bool = false
    @State private var errorMessage: String?

    /// Live reactive read of the scout for `(userId, scoutId)`. Replaces
    /// the prior `@State var scout: APIClient.ScoutDTO?` cache. `ScoutStore`
    /// mutations write via `upsertLocal`, so edits / pause / resume / archive
    /// land in SwiftData and the @Query republishes a fresh row to the view.
    @Query private var matchedScouts: [Scout]

    @Environment(\.dismiss) private var dismiss

    init(userId: String, scoutId: String) {
        self.userId = userId
        self.scoutId = scoutId

        let predicate = #Predicate<Scout> { scout in
            scout.id == scoutId && scout.userId == userId
        }
        _matchedScouts = Query(filter: predicate)
    }

    private var scout: Scout? { matchedScouts.first }

    enum FindingFilter: String, CaseIterable, Identifiable {
        case all, article, insight, task
        var id: String { rawValue }
        var title: String { self == .all ? "All" : rawValue.capitalized }
        var serverValue: String? { self == .all ? nil : rawValue }
    }

    enum MemoryFilter: String, CaseIterable, Identifiable {
        case all, factual, judgment, pattern
        var id: String { rawValue }
        var title: String { self == .all ? "All" : rawValue.capitalized }
        var serverValue: String? { self == .all ? nil : rawValue }
    }

    var body: some View {
        ZStack {
            BackgroundView()

            if let scout {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        headerCard(scout)
                        findingsSection
                        activitySection
                        memorySection
                        settingsSection(scout)
                        Spacer(minLength: 100)
                    }
                    .padding(.top, 8)
                }
                .scrollIndicators(.hidden)

                runFAB(scout: scout)
            } else {
                ProgressView().tint(BrettColors.gold)
            }
        }
        // Default iOS back button; kept consistent with ListView +
        // ScoutsRosterView (which also use the default now). Setting a
        // `.navigationTitle` is required for SwiftUI to wire the
        // interactive pop gesture — without it (or another navbar
        // registrant), edge-swipe-to-go-back silently breaks.
        .navigationTitle(scout?.name ?? "Scout")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadAll() }
        .onChange(of: findingsType) { _, _ in Task { await refreshFindings() } }
        .onChange(of: memoryFilter) { _, _ in Task { await refreshMemories() } }
        .sheet(isPresented: $isPresentingEdit) {
            if let scout {
                ScoutEditSheet(scout: scout) { patch in
                    do {
                        _ = try await scoutStore.update(id: scout.id, changes: patch)
                    } catch {
                        errorMessage = "Couldn't save changes."
                    }
                }
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
            }
        }
        .alert("Delete scout?", isPresented: $pendingDelete) {
            Button("Delete", role: .destructive) {
                Task {
                    try? await scoutStore.delete(id: scoutId)
                    dismiss()
                }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This removes the scout and all its findings.")
        }
    }

    // MARK: - Header

    @ViewBuilder
    private func headerCard(_ scout: Scout) -> some View {
        GlassCard(tint: BrettColors.cerulean) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 14) {
                    ScoutAvatar(
                        letter: scout.avatarLetter,
                        gradient: scout.avatarGradient,
                        diameter: 52,
                        showGlow: scout.status == "active"
                    )

                    VStack(alignment: .leading, spacing: 4) {
                        Text(scout.name)
                            .font(BrettTypography.detailTitle)
                            .foregroundStyle(.white)

                        HStack(spacing: 6) {
                            StatusDot(status: scout.status)
                            Text(scout.status.capitalized)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(BrettColors.textSecondary)
                            Text("·")
                                .foregroundStyle(BrettColors.textGhost)
                            Text(nextRunLabel(scout))
                                .font(.system(size: 11))
                                .foregroundStyle(BrettColors.textMeta)
                        }
                    }

                    Spacer()
                }

                if let statusLine = scout.statusLine {
                    Text(statusLine)
                        .font(.system(size: 13, weight: .regular).italic())
                        .foregroundStyle(BrettColors.cerulean.opacity(0.85))
                }

                budgetBar(scout)
            }
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private func budgetBar(_ scout: Scout) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("BUDGET")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.sectionLabelColor)
                Spacer()
                Text("\(scout.budgetUsed) / \(scout.budgetTotal)")
                    .font(.system(size: 11))
                    .foregroundStyle(BrettColors.textMeta)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.white.opacity(0.1))
                        .frame(height: 4)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(BrettColors.gold)
                        .frame(
                            width: geo.size.width * ScoutCard.budgetFraction(
                                used: scout.budgetUsed,
                                total: scout.budgetTotal
                            ),
                            height: 4
                        )
                }
            }
            .frame(height: 4)
        }
    }

    private func nextRunLabel(_ scout: Scout) -> String {
        if let last = scout.lastRun {
            return "Last run \(FindingCard.relative(last)) ago"
        }
        return "Not yet run"
    }

    // MARK: - Findings

    @ViewBuilder
    private var findingsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("FINDINGS", trailing: "\(findings.count)")

            Picker("Type", selection: $findingsType) {
                ForEach(FindingFilter.allCases) { f in
                    Text(f.title).tag(f)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)

            if findings.isEmpty {
                GlassCard {
                    Text("No findings yet — check back soon.")
                        .font(.system(size: 13))
                        .foregroundStyle(BrettColors.textMeta)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 20)
                }
                .padding(.horizontal, 16)
            } else {
                ForEach(findings, id: \.id) { finding in
                    FindingCard(
                        finding: finding,
                        feedback: localFeedback[finding.id] ?? finding.feedbackUseful,
                        onFeedback: { useful in
                            Task { await submitFeedback(finding: finding, useful: useful) }
                        },
                        onOpen: nil
                    )
                    .padding(.horizontal, 16)
                }

                if findingsCursor != nil {
                    Button {
                        Task { await loadMoreFindings() }
                    } label: {
                        Text("Load more")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(BrettColors.gold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Activity

    @ViewBuilder
    private var activitySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("ACTIVITY", trailing: "\(activity.count)")

            if activity.isEmpty {
                GlassCard {
                    Text("No activity yet.")
                        .font(.system(size: 13))
                        .foregroundStyle(BrettColors.textMeta)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 20)
                }
                .padding(.horizontal, 16)
            } else {
                GlassCard {
                    VStack(spacing: 4) {
                        ForEach(Array(activity.prefix(20).enumerated()), id: \.offset) { idx, entry in
                            ActivityRow(entry: entry)
                            if idx < min(activity.count, 20) - 1 {
                                Divider()
                                    .overlay(BrettColors.hairline)
                                    .padding(.horizontal, 12)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: - Memory

    @ViewBuilder
    private var memorySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("MEMORY", trailing: "\(memories.count)")

            Picker("Type", selection: $memoryFilter) {
                ForEach(MemoryFilter.allCases) { f in
                    Text(f.title).tag(f)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)

            if memories.isEmpty {
                GlassCard {
                    Text("Brett hasn't learned anything persistent yet.")
                        .font(.system(size: 13))
                        .foregroundStyle(BrettColors.textMeta)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 20)
                }
                .padding(.horizontal, 16)
            } else {
                GlassCard(tint: BrettColors.cerulean) {
                    VStack(spacing: 0) {
                        ForEach(memories, id: \.id) { memory in
                            MemoryCard(memory: memory) {
                                Task { await deleteMemory(memory) }
                            }
                            if memory.id != memories.last?.id {
                                Divider()
                                    .overlay(BrettColors.hairline)
                                    .padding(.horizontal, 12)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: - Settings / Danger

    @ViewBuilder
    private func settingsSection(_ scout: Scout) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("SETTINGS", trailing: nil)

            GlassCard {
                VStack(spacing: 0) {
                    Button {
                        isPresentingEdit = true
                    } label: {
                        HStack {
                            Image(systemName: "pencil")
                                .font(.system(size: 14))
                                .foregroundStyle(BrettColors.cerulean)
                            Text("Edit scout")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(.white)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11))
                                .foregroundStyle(BrettColors.textGhost)
                        }
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(.plain)

                    Divider().overlay(BrettColors.hairline)

                    if scout.status == "paused" {
                        settingsButton(icon: "play.circle", label: "Resume scout", color: BrettColors.emerald) {
                            Task {
                                _ = try? await scoutStore.resume(id: scout.id)
                            }
                        }
                    } else if scout.status == "active" {
                        settingsButton(icon: "pause.circle", label: "Pause scout", color: BrettColors.textInactive) {
                            Task {
                                _ = try? await scoutStore.pause(id: scout.id)
                            }
                        }
                    }

                    Divider().overlay(BrettColors.hairline)

                    settingsButton(icon: "archivebox", label: "Archive", color: BrettColors.textInactive) {
                        Task {
                            _ = try? await scoutStore.archive(id: scout.id)
                        }
                    }

                    Divider().overlay(BrettColors.hairline)

                    settingsButton(icon: "trash", label: "Delete scout", color: BrettColors.error) {
                        pendingDelete = true
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private func settingsButton(icon: String, label: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundStyle(color)
                Text(label)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(color)
                Spacer()
            }
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }

    // MARK: - FAB

    @ViewBuilder
    private func runFAB(scout: Scout) -> some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                Button {
                    Task { await triggerRun() }
                } label: {
                    HStack(spacing: 6) {
                        if isRunning {
                            ProgressView().tint(.white)
                        } else {
                            Image(systemName: "bolt.fill")
                                .font(.system(size: 14, weight: .bold))
                        }
                        Text(isRunning ? "Running..." : "Run now")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .background(
                        Capsule()
                            .fill(BrettColors.gold)
                            .shadow(color: BrettColors.gold.opacity(0.6), radius: 12)
                    )
                }
                .buttonStyle(.plain)
                .disabled(isRunning || scout.status == "paused")
                .padding(.trailing, 20)
                .padding(.bottom, 20)
            }
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func sectionLabel(_ text: String, trailing: String?) -> some View {
        HStack {
            Text(text)
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(BrettColors.sectionLabelColor)
            Spacer()
            if let trailing {
                Text(trailing)
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
            }
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Data loading

    private func loadAll() async {
        // Refresh the scout from the server. Result lands in SwiftData via
        // upsertLocal and the @Query reactively re-renders — no need to
        // hold the returned DTO locally.
        do {
            _ = try await scoutStore.fetchDetail(id: scoutId)
        } catch {
            errorMessage = "Couldn't load scout."
        }
        await refreshFindings()
        await refreshActivity()
        await refreshMemories()
    }

    private func refreshFindings() async {
        do {
            let page = try await scoutStore.fetchFindingsPage(
                scoutId: scoutId,
                type: findingsType.serverValue,
                cursor: nil
            )
            findings = page.findings
            findingsCursor = page.cursor
        } catch {}
    }

    private func loadMoreFindings() async {
        guard let cursor = findingsCursor else { return }
        do {
            let page = try await scoutStore.fetchFindingsPage(
                scoutId: scoutId,
                type: findingsType.serverValue,
                cursor: cursor
            )
            findings.append(contentsOf: page.findings)
            findingsCursor = page.cursor
        } catch {}
    }

    private func refreshActivity() async {
        do {
            let page = try await scoutStore.fetchActivity(scoutId: scoutId)
            activity = page.entries
        } catch {}
    }

    private func refreshMemories() async {
        do {
            memories = try await scoutStore.fetchMemories(
                scoutId: scoutId,
                type: memoryFilter.serverValue
            )
        } catch {}
    }

    private func submitFeedback(finding: APIClient.FindingDTO, useful: Bool?) async {
        let previous = localFeedback[finding.id] ?? finding.feedbackUseful
        localFeedback[finding.id] = useful
        do {
            _ = try await scoutStore.submitFeedback(
                scoutId: scoutId,
                findingId: finding.id,
                useful: useful
            )
        } catch {
            localFeedback[finding.id] = previous
        }
    }

    private func deleteMemory(_ memory: APIClient.MemoryDTO) async {
        let previous = memories
        memories.removeAll { $0.id == memory.id }
        do {
            try await scoutStore.deleteMemory(scoutId: scoutId, memoryId: memory.id)
        } catch {
            memories = previous
        }
    }

    private func triggerRun() async {
        isRunning = true
        defer { isRunning = false }
        do {
            try await scoutStore.triggerRun(id: scoutId)
            try? await Task.sleep(for: .seconds(1))
            await refreshActivity()
            await refreshFindings()
        } catch {
            errorMessage = "Couldn't trigger run."
        }
    }
}
