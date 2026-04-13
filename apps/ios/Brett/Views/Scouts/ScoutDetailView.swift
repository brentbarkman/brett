import SwiftUI

struct ScoutDetailView: View {
    @Bindable var store: MockStore
    let scoutId: String
    @Environment(\.dismiss) private var dismiss

    private var scout: MockScout? {
        store.scouts.first(where: { $0.id == scoutId })
    }

    var body: some View {
        ZStack {
            BackgroundView()

            if let scout {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        // MARK: - Header
                        headerSection(scout)

                        // MARK: - Goal
                        goalSection(scout)

                        // MARK: - Config strip
                        configSection(scout)

                        // MARK: - Findings
                        findingsSection(scout)

                        Spacer(minLength: 40)
                    }
                    .padding(.top, 8)
                }
                .scrollIndicators(.hidden)
            }
        }
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Scouts")
                            .font(.system(size: 16, weight: .medium))
                    }
                    .foregroundStyle(BrettColors.gold)
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    if scout?.status == .active {
                        Button { } label: {
                            Label("Pause Scout", systemImage: "pause.circle")
                        }
                        Button { } label: {
                            Label("Run Now", systemImage: "bolt.circle")
                        }
                    } else {
                        Button { } label: {
                            Label("Resume Scout", systemImage: "play.circle")
                        }
                    }
                    Divider()
                    Button(role: .destructive) { } label: {
                        Label("Delete Scout", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.40))
                }
            }
        }
    }

    // MARK: - Header

    @ViewBuilder
    private func headerSection(_ scout: MockScout) -> some View {
        HStack(spacing: 14) {
            // Large avatar
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: scout.status == .active
                                ? [BrettColors.gold.opacity(0.6), BrettColors.cerulean.opacity(0.4)]
                                : [Color.white.opacity(0.15), Color.white.opacity(0.08)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 52, height: 52)

                // Ambient glow for active scouts
                if scout.status == .active {
                    Circle()
                        .fill(BrettColors.gold.opacity(0.15))
                        .frame(width: 68, height: 68)
                        .blur(radius: 12)
                }

                Text(String(scout.name.prefix(1)))
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(scout.name)
                    .font(BrettTypography.detailTitle)
                    .foregroundStyle(.white)

                HStack(spacing: 8) {
                    // Status badge
                    HStack(spacing: 4) {
                        Circle()
                            .fill(scout.status == .active ? Color(red: 52/255, green: 211/255, blue: 153/255) : BrettColors.textMeta)
                            .frame(width: 6, height: 6)
                        Text(scout.status.rawValue.capitalized)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(scout.status == .active ? Color(red: 52/255, green: 211/255, blue: 153/255) : BrettColors.textMeta)
                    }

                    Text("·")
                        .foregroundStyle(BrettColors.textGhost)

                    Text("Last run \(scout.lastRunAgo)")
                        .font(.system(size: 11))
                        .foregroundStyle(BrettColors.textMeta)
                }
            }
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Goal

    @ViewBuilder
    private func goalSection(_ scout: MockScout) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("GOAL")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(BrettColors.sectionLabelColor)
                .padding(.horizontal, 20)

            GlassCard {
                Text(scout.goal)
                    .font(BrettTypography.body)
                    .foregroundStyle(BrettColors.textBody)
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Config strip

    @ViewBuilder
    private func configSection(_ scout: MockScout) -> some View {
        GlassCard {
            VStack(spacing: 12) {
                HStack {
                    Text("CONFIGURATION")
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                        .foregroundStyle(BrettColors.sectionLabelColor)
                    Spacer()
                }

                // Config items in a grid-like layout
                HStack(spacing: 16) {
                    configItem(label: "Sensitivity", value: scout.sensitivity)
                    configItem(label: "Cadence", value: scout.cadence)
                }

                HStack(spacing: 16) {
                    configItem(label: "Budget", value: "\(scout.budgetUsed)/\(scout.budgetTotal)")
                    configItem(label: "Findings", value: "\(scout.findingsCount)")
                }

                // Budget progress bar
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color.white.opacity(0.10))
                            .frame(height: 4)

                        RoundedRectangle(cornerRadius: 2)
                            .fill(budgetColor(used: scout.budgetUsed, total: scout.budgetTotal))
                            .frame(width: geo.size.width * CGFloat(scout.budgetUsed) / CGFloat(max(scout.budgetTotal, 1)), height: 4)
                    }
                }
                .frame(height: 4)
            }
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Findings

    @ViewBuilder
    private func findingsSection(_ scout: MockScout) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("FINDINGS")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.sectionLabelColor)

                Spacer()

                Text("\(scout.findings.count)")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
            }
            .padding(.horizontal, 20)

            if scout.findings.isEmpty {
                GlassCard {
                    VStack(spacing: 8) {
                        Image(systemName: "sparkle")
                            .font(.system(size: 24, weight: .light))
                            .foregroundStyle(BrettColors.textGhost)
                        Text("No findings yet")
                            .font(BrettTypography.body)
                            .foregroundStyle(BrettColors.textMeta)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 20)
                }
                .padding(.horizontal, 16)
            } else {
                ForEach(scout.findings) { finding in
                    FindingCard(finding: finding)
                        .padding(.horizontal, 16)
                }
            }
        }
    }

    // MARK: - Helpers

    private func configItem(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(BrettColors.textMeta)
            Text(value)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(BrettColors.textCardTitle)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func budgetColor(used: Int, total: Int) -> Color {
        let ratio = Double(used) / Double(max(total, 1))
        if ratio < 0.5 { return Color(red: 52/255, green: 211/255, blue: 153/255) } // emerald
        if ratio < 0.8 { return BrettColors.cerulean }
        return BrettColors.error
    }
}

// MARK: - Finding Card

struct FindingCard: View {
    let finding: MockFinding

    var body: some View {
        GlassCard(tint: findingTint) {
            VStack(alignment: .leading, spacing: 8) {
                // Type badge + relevance
                HStack {
                    HStack(spacing: 4) {
                        Image(systemName: findingIcon)
                            .font(.system(size: 10, weight: .semibold))
                        Text(finding.type.rawValue.capitalized)
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .foregroundStyle(findingColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(findingColor.opacity(0.15), in: Capsule())

                    Spacer()

                    Text(finding.ago)
                        .font(BrettTypography.taskMeta)
                        .foregroundStyle(BrettColors.textMeta)
                }

                // Title
                Text(finding.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(BrettColors.textCardTitle)

                // Description
                Text(finding.description)
                    .font(BrettTypography.body)
                    .foregroundStyle(BrettColors.textBody)
                    .lineLimit(3)

                // Source + feedback
                HStack {
                    Image(systemName: "link")
                        .font(.system(size: 10))
                    Text(finding.source)
                        .font(BrettTypography.taskMeta)

                    Spacer()

                    // Feedback buttons
                    HStack(spacing: 8) {
                        Button { } label: {
                            Image(systemName: "hand.thumbsup")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(finding.feedbackUseful == true ? Color(red: 52/255, green: 211/255, blue: 153/255) : BrettColors.textMeta)
                        }
                        .buttonStyle(.plain)

                        Button { } label: {
                            Image(systemName: "hand.thumbsdown")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(finding.feedbackUseful == false ? BrettColors.error : BrettColors.textMeta)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .foregroundStyle(BrettColors.textMeta)
            }
        }
    }

    private var findingTint: Color {
        switch finding.type {
        case .insight: return Color.purple
        case .article: return BrettColors.gold
        case .task: return Color.orange
        }
    }

    private var findingColor: Color {
        switch finding.type {
        case .insight: return Color.purple
        case .article: return BrettColors.gold
        case .task: return Color.orange
        }
    }

    private var findingIcon: String {
        switch finding.type {
        case .insight: return "lightbulb.fill"
        case .article: return "doc.text"
        case .task: return "bolt.fill"
        }
    }
}
