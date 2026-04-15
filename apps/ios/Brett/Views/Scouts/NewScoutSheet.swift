import SwiftUI

/// Multi-step bottom-sheet to create a new scout.
///
/// Steps: Basics → Sources → Behaviour → Review. Keeps state in a local
/// `@State` draft so the user can step back without losing input. On Create
/// we hand the payload to `onCreate` and dismiss.
struct NewScoutSheet: View {
    let onCreate: (APIClient.NewScoutPayload) async -> Void
    @Environment(\.dismiss) private var dismiss

    // Draft state
    @State private var step: Int = 0
    @State private var name: String = ""
    @State private var goal: String = ""
    @State private var context: String = ""
    @State private var sources: [SourceDraft] = []
    @State private var newSourceName: String = ""
    @State private var newSourceUrl: String = ""
    @State private var sensitivity: String = "medium"
    @State private var analysisTier: String = "standard"
    @State private var cadenceHours: Double = 24
    @State private var budgetTotal: Int = 60
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    struct SourceDraft: Identifiable, Hashable {
        let id = UUID()
        var name: String
        var url: String?
    }

    var body: some View {
        ZStack {
            BackgroundView()
            VStack(alignment: .leading, spacing: 0) {
                header
                Divider().overlay(BrettColors.cardBorder)

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        switch step {
                        case 0: basicsStep
                        case 1: sourcesStep
                        case 2: behaviourStep
                        default: reviewStep
                        }
                    }
                    .padding(20)
                }

                footer
            }
        }
    }

    // MARK: - Steps

    @ViewBuilder
    private var basicsStep: some View {
        sectionLabel("BASICS")
        glassField(title: "Name") {
            TextField("e.g. Coffee Deals", text: $name)
                .textFieldStyle(.plain)
                .foregroundStyle(.white)
        }
        glassField(title: "Goal — what should Brett watch for?") {
            TextField("e.g. Find deals on specialty coffee beans under $20", text: $goal, axis: .vertical)
                .textFieldStyle(.plain)
                .foregroundStyle(.white)
                .lineLimit(3...6)
        }
        glassField(title: "Additional context (optional)") {
            TextField("Constraints, preferences, exclusions", text: $context, axis: .vertical)
                .textFieldStyle(.plain)
                .foregroundStyle(.white)
                .lineLimit(2...5)
        }
    }

    @ViewBuilder
    private var sourcesStep: some View {
        sectionLabel("SOURCES")
        Text("Where should your scout look? Add URLs, RSS feeds, or handles.")
            .font(.system(size: 12))
            .foregroundStyle(BrettColors.textMeta)

        ForEach(sources) { source in
            GlassCard {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(source.name)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(.white)
                        if let url = source.url {
                            Text(url)
                                .font(.system(size: 11))
                                .foregroundStyle(BrettColors.textMeta)
                                .lineLimit(1)
                        }
                    }
                    Spacer()
                    Button {
                        sources.removeAll { $0.id == source.id }
                    } label: {
                        Image(systemName: "trash")
                            .foregroundStyle(BrettColors.error)
                    }
                    .buttonStyle(.plain)
                }
            }
        }

        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                TextField("Source name", text: $newSourceName)
                    .textFieldStyle(.plain)
                    .foregroundStyle(.white)
                    .font(.system(size: 14))
                TextField("URL (optional)", text: $newSourceUrl)
                    .textFieldStyle(.plain)
                    .foregroundStyle(.white)
                    .font(.system(size: 14))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)

                Button {
                    addSource()
                } label: {
                    Text("Add source")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(BrettColors.gold)
                }
                .buttonStyle(.plain)
                .disabled(newSourceName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    @ViewBuilder
    private var behaviourStep: some View {
        sectionLabel("BEHAVIOUR")

        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("Sensitivity")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(BrettColors.textBody)
                Picker("Sensitivity", selection: $sensitivity) {
                    Text("Low").tag("low")
                    Text("Medium").tag("medium")
                    Text("High").tag("high")
                }
                .pickerStyle(.segmented)

                Divider().overlay(BrettColors.cardBorder)

                Text("Analysis tier")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(BrettColors.textBody)
                Picker("Tier", selection: $analysisTier) {
                    Text("Standard").tag("standard")
                    Text("Deep").tag("deep")
                }
                .pickerStyle(.segmented)

                Divider().overlay(BrettColors.cardBorder)

                HStack {
                    Text("Cadence")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(BrettColors.textBody)
                    Spacer()
                    Text("every \(cadenceHoursLabel)")
                        .font(.system(size: 12))
                        .foregroundStyle(BrettColors.textMeta)
                }
                Slider(value: $cadenceHours, in: 1...168, step: 1)
                    .tint(BrettColors.gold)

                Divider().overlay(BrettColors.cardBorder)

                HStack {
                    Text("Budget")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(BrettColors.textBody)
                    Spacer()
                    Text("\(budgetTotal) runs")
                        .font(.system(size: 12))
                        .foregroundStyle(BrettColors.textMeta)
                }
                Slider(
                    value: Binding(
                        get: { Double(budgetTotal) },
                        set: { budgetTotal = Int($0) }
                    ),
                    in: 5...300,
                    step: 5
                )
                .tint(BrettColors.gold)
            }
        }
    }

    @ViewBuilder
    private var reviewStep: some View {
        sectionLabel("REVIEW")

        GlassCard {
            VStack(alignment: .leading, spacing: 8) {
                reviewRow("Name", name)
                reviewRow("Goal", goal)
                if !context.isEmpty {
                    reviewRow("Context", context)
                }
                reviewRow("Sources", sources.isEmpty ? "None — Brett will search broadly" : sources.map(\.name).joined(separator: ", "))
                reviewRow("Sensitivity", sensitivity.capitalized)
                reviewRow("Analysis", analysisTier.capitalized)
                reviewRow("Cadence", "every \(cadenceHoursLabel)")
                reviewRow("Budget", "\(budgetTotal) runs")
            }
        }

        if let errorMessage {
            Text(errorMessage)
                .font(.system(size: 12))
                .foregroundStyle(BrettColors.error)
        }
    }

    private func reviewRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(BrettColors.textMeta)
                .frame(width: 90, alignment: .leading)
            Text(value)
                .font(.system(size: 13))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Chrome

    @ViewBuilder
    private var header: some View {
        HStack {
            Button("Cancel") { dismiss() }
                .foregroundStyle(BrettColors.textInactive)

            Spacer()

            Text("New Scout")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)

            Spacer()

            // invisible to balance layout
            Text("Cancel").opacity(0)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    @ViewBuilder
    private var footer: some View {
        HStack {
            if step > 0 {
                Button {
                    step -= 1
                } label: {
                    Text("Back")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(BrettColors.textInactive)
                }
                .buttonStyle(.plain)
            }

            Spacer()

            Button {
                Task { await advance() }
            } label: {
                Text(step < 3 ? "Next" : "Create")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(BrettColors.gold, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(!canAdvance || isSubmitting)
            .opacity(canAdvance ? 1 : 0.5)
        }
        .padding(20)
    }

    // MARK: - Logic

    private var canAdvance: Bool {
        switch step {
        case 0:
            return !name.trimmingCharacters(in: .whitespaces).isEmpty
                && !goal.trimmingCharacters(in: .whitespaces).isEmpty
        default:
            return true
        }
    }

    private var cadenceHoursLabel: String {
        if cadenceHours < 24 { return "\(Int(cadenceHours))h" }
        let days = Int(cadenceHours / 24)
        return "\(days)d"
    }

    private func addSource() {
        let trimmedName = newSourceName.trimmingCharacters(in: .whitespaces)
        guard !trimmedName.isEmpty else { return }
        let trimmedUrl = newSourceUrl.trimmingCharacters(in: .whitespaces)
        sources.append(SourceDraft(
            name: trimmedName,
            url: trimmedUrl.isEmpty ? nil : trimmedUrl
        ))
        newSourceName = ""
        newSourceUrl = ""
    }

    private func advance() async {
        guard canAdvance else { return }
        if step < 3 {
            step += 1
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }

        let payload = APIClient.NewScoutPayload(
            name: name,
            avatarLetter: String(name.trimmingCharacters(in: .whitespaces).prefix(1).uppercased()),
            avatarGradientFrom: "#E8B931",
            avatarGradientTo: "#4682C3",
            goal: goal,
            context: context.isEmpty ? nil : context,
            sources: sources.map { APIClient.ScoutSourceDTO(name: $0.name, url: $0.url) },
            sensitivity: sensitivity,
            analysisTier: analysisTier,
            cadenceIntervalHours: cadenceHours,
            cadenceMinIntervalHours: max(0.25, cadenceHours / 2),
            budgetTotal: budgetTotal
        )

        await onCreate(payload)
        dismiss()
    }

    // MARK: - Fragments

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(BrettTypography.sectionLabel)
            .tracking(2.4)
            .foregroundStyle(BrettColors.sectionLabelColor)
    }

    private func glassField<Content: View>(title: String, @ViewBuilder _ content: @escaping () -> Content) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(BrettColors.textMeta)
                content()
            }
        }
    }
}
