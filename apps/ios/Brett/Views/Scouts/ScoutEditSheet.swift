import SwiftUI

/// Inline sheet for editing an existing scout. Lets the user tweak the
/// name / goal / context / sensitivity / cadence. On save, hands the patch
/// back via `onSave` which is responsible for calling the store.
///
/// Initialized from either a SwiftData `Scout` row or an API `ScoutDTO`
/// — both expose the same five edit fields, but `ScoutDetailView` now
/// reads the SwiftData row via `@Query`, so we accept the field values
/// directly and provide convenience initializers for both shapes.
struct ScoutEditSheet: View {
    /// Original values, used by `hasChanges` to detect dirty fields.
    let originalName: String
    let originalGoal: String
    let originalContext: String?
    let originalSensitivity: String
    let originalCadenceIntervalHours: Double

    let onSave: (APIClient.ScoutUpdatePayload) async -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var goal: String
    @State private var context: String
    @State private var sensitivity: String
    @State private var cadenceHours: Double
    @State private var isSaving: Bool = false
    @State private var errorMessage: String?

    init(
        name: String,
        goal: String,
        context: String?,
        sensitivity: String,
        cadenceIntervalHours: Double,
        onSave: @escaping (APIClient.ScoutUpdatePayload) async -> Void
    ) {
        self.originalName = name
        self.originalGoal = goal
        self.originalContext = context
        self.originalSensitivity = sensitivity
        self.originalCadenceIntervalHours = cadenceIntervalHours
        self.onSave = onSave
        _name = State(initialValue: name)
        _goal = State(initialValue: goal)
        _context = State(initialValue: context ?? "")
        _sensitivity = State(initialValue: sensitivity)
        _cadenceHours = State(initialValue: cadenceIntervalHours)
    }

    init(scout: APIClient.ScoutDTO, onSave: @escaping (APIClient.ScoutUpdatePayload) async -> Void) {
        self.init(
            name: scout.name,
            goal: scout.goal,
            context: scout.context,
            sensitivity: scout.sensitivity,
            cadenceIntervalHours: scout.cadenceIntervalHours,
            onSave: onSave
        )
    }

    init(scout: Scout, onSave: @escaping (APIClient.ScoutUpdatePayload) async -> Void) {
        self.init(
            name: scout.name,
            goal: scout.goal,
            context: scout.context,
            sensitivity: scout.sensitivity,
            cadenceIntervalHours: scout.cadenceIntervalHours,
            onSave: onSave
        )
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
        name != originalName
            || goal != originalGoal
            || context != (originalContext ?? "")
            || sensitivity != originalSensitivity
            || cadenceHours != originalCadenceIntervalHours
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
        if name != originalName { patch.name = name }
        if goal != originalGoal { patch.goal = goal }
        if context != (originalContext ?? "") { patch.context = context }
        if sensitivity != originalSensitivity { patch.sensitivity = sensitivity }
        if cadenceHours != originalCadenceIntervalHours {
            patch.cadenceIntervalHours = cadenceHours
        }

        await onSave(patch)
        dismiss()
    }
}
