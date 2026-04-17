import SwiftUI

/// Inline sheet for editing an existing scout. Lets the user tweak the
/// name / goal / context / sensitivity / cadence. On save, hands the patch
/// back via `onSave` which is responsible for calling the store.
struct ScoutEditSheet: View {
    let scout: APIClient.ScoutDTO
    let onSave: (APIClient.ScoutUpdatePayload) async -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var goal: String
    @State private var context: String
    @State private var sensitivity: String
    @State private var cadenceHours: Double
    @State private var isSaving: Bool = false
    @State private var errorMessage: String?

    init(scout: APIClient.ScoutDTO, onSave: @escaping (APIClient.ScoutUpdatePayload) async -> Void) {
        self.scout = scout
        self.onSave = onSave
        _name = State(initialValue: scout.name)
        _goal = State(initialValue: scout.goal)
        _context = State(initialValue: scout.context ?? "")
        _sensitivity = State(initialValue: scout.sensitivity)
        _cadenceHours = State(initialValue: scout.cadenceIntervalHours)
    }

    var body: some View {
        ZStack {
            BackgroundView()
            VStack(alignment: .leading, spacing: 0) {
                header
                Divider().overlay(BrettColors.cardBorder)

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        glassField(title: "Name") {
                            TextField("Scout name", text: $name)
                                .textFieldStyle(.plain)
                                .foregroundStyle(.white)
                        }
                        glassField(title: "Goal") {
                            TextField("What should this scout watch for?", text: $goal, axis: .vertical)
                                .textFieldStyle(.plain)
                                .foregroundStyle(.white)
                                .lineLimit(3...6)
                        }
                        glassField(title: "Context") {
                            TextField("Optional additional context", text: $context, axis: .vertical)
                                .textFieldStyle(.plain)
                                .foregroundStyle(.white)
                                .lineLimit(2...5)
                        }

                        GlassCard {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("Sensitivity")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(BrettColors.textMeta)
                                Picker("Sensitivity", selection: $sensitivity) {
                                    Text("Low").tag("low")
                                    Text("Medium").tag("medium")
                                    Text("High").tag("high")
                                }
                                .pickerStyle(.segmented)

                                Divider().overlay(BrettColors.cardBorder)

                                HStack {
                                    Text("Cadence")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(BrettColors.textMeta)
                                    Spacer()
                                    Text("every \(cadenceLabel)")
                                        .font(.system(size: 12))
                                        .foregroundStyle(BrettColors.textMeta)
                                }
                                Slider(value: $cadenceHours, in: 1...168, step: 1)
                                    .tint(BrettColors.gold)
                            }
                        }

                        if let errorMessage {
                            Text(errorMessage)
                                .font(.system(size: 12))
                                .foregroundStyle(BrettColors.error)
                        }
                    }
                    .padding(20)
                }
            }
        }
    }

    // MARK: - Fragments

    @ViewBuilder
    private var header: some View {
        HStack {
            Button("Cancel") { dismiss() }
                .foregroundStyle(BrettColors.textInactive)

            Spacer()

            Text("Edit Scout")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)

            Spacer()

            Button {
                Task { await save() }
            } label: {
                Text("Save")
                    .foregroundStyle(BrettColors.gold)
                    .fontWeight(.semibold)
            }
            .disabled(isSaving || !hasChanges)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
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

    // MARK: - Logic

    private var hasChanges: Bool {
        name != scout.name
            || goal != scout.goal
            || context != (scout.context ?? "")
            || sensitivity != scout.sensitivity
            || cadenceHours != scout.cadenceIntervalHours
    }

    private var cadenceLabel: String {
        if cadenceHours < 24 { return "\(Int(cadenceHours))h" }
        return "\(Int(cadenceHours / 24))d"
    }

    private func save() async {
        guard hasChanges else { return }
        isSaving = true
        defer { isSaving = false }

        var patch = APIClient.ScoutUpdatePayload()
        if name != scout.name { patch.name = name }
        if goal != scout.goal { patch.goal = goal }
        if context != (scout.context ?? "") { patch.context = context }
        if sensitivity != scout.sensitivity { patch.sensitivity = sensitivity }
        if cadenceHours != scout.cadenceIntervalHours {
            patch.cadenceIntervalHours = cadenceHours
        }

        await onSave(patch)
        dismiss()
    }
}
