import SwiftUI

struct TaskDetailView: View {
    @Bindable var store: MockStore
    let itemId: String
    @Environment(\.dismiss) private var dismiss
    @State private var isEditingTitle = false
    @State private var titleDraft = ""

    private var item: MockItem? {
        store.items.first(where: { $0.id == itemId }) ??
        store.inboxItems.first(where: { $0.id == itemId })
    }

    var body: some View {
        ZStack {
            BackgroundView()

            if let item {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        // MARK: - Header
                        headerSection(item)

                        // MARK: - Title
                        titleSection(item)

                        // MARK: - Schedule card
                        scheduleCard(item)

                        // MARK: - Notes
                        if let notes = item.notes, !notes.isEmpty {
                            notesCard(notes)
                        }

                        // MARK: - Subtasks
                        if !item.subtasks.isEmpty {
                            subtasksCard(item.subtasks)
                        }

                        // MARK: - Brett chat
                        brettChatCard(item)

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
                        Text("Back")
                            .font(.system(size: 16, weight: .medium))
                    }
                    .foregroundStyle(BrettColors.gold)
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                if let item {
                    Menu {
                        Button { store.toggleItem(item.id) } label: {
                            Label(item.isCompleted ? "Mark Incomplete" : "Complete", systemImage: item.isCompleted ? "arrow.uturn.backward" : "checkmark.circle")
                        }
                        Divider()
                        Button(role: .destructive) {
                            // Delete — mock only
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.40))
                    }
                }
            }
        }
    }

    // MARK: - Header: label + status badge

    @ViewBuilder
    private func headerSection(_ item: MockItem) -> some View {
        HStack(spacing: 8) {
            Text("TASK")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(BrettColors.sectionLabelColor)

            if item.isCompleted {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 10))
                    Text("DONE")
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                }
                .foregroundStyle(BrettColors.success)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(BrettColors.success.opacity(0.15), in: Capsule())
            }

            Spacer()
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Title (tap to edit)

    @ViewBuilder
    private func titleSection(_ item: MockItem) -> some View {
        HStack(alignment: .top, spacing: 14) {
            TaskCheckbox(isChecked: item.isCompleted) {
                store.toggleItem(item.id)
            }

            if isEditingTitle {
                TextField("Task title", text: $titleDraft)
                    .font(BrettTypography.detailTitle)
                    .foregroundStyle(.white)
                    .tint(BrettColors.gold)
                    .submitLabel(.done)
                    .onSubmit { commitTitle(item) }
                    .onAppear { titleDraft = item.title }
            } else {
                Text(item.title)
                    .font(BrettTypography.detailTitle)
                    .foregroundStyle(item.isCompleted ? BrettColors.textMeta : .white)
                    .strikethrough(item.isCompleted, color: BrettColors.textGhost)
                    .onTapGesture { isEditingTitle = true; titleDraft = item.title }
            }
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Schedule card (due, list, reminder, recurrence)

    @ViewBuilder
    private func scheduleCard(_ item: MockItem) -> some View {
        GlassCard {
            VStack(spacing: 0) {
                scheduleRow(
                    icon: "calendar",
                    label: "Due",
                    value: item.dueDate.map { DateHelpers.formatRelativeDate($0) } ?? "None",
                    valueColor: urgencyColor(for: item)
                )

                Divider().background(BrettColors.hairline)

                scheduleRow(
                    icon: "folder",
                    label: "List",
                    value: item.listName ?? "Inbox",
                    valueColor: BrettColors.gold
                )

                Divider().background(BrettColors.hairline)

                scheduleRow(
                    icon: "bell",
                    label: "Reminder",
                    value: "None",
                    valueColor: BrettColors.textMeta
                )

                Divider().background(BrettColors.hairline)

                scheduleRow(
                    icon: "repeat",
                    label: "Recurrence",
                    value: "None",
                    valueColor: BrettColors.textMeta
                )
            }
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Notes card

    @ViewBuilder
    private func notesCard(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("NOTES")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(BrettColors.sectionLabelColor)
                .padding(.horizontal, 20)

            GlassCard {
                Text(notes)
                    .font(BrettTypography.body)
                    .foregroundStyle(BrettColors.textBody)
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Subtasks card

    @ViewBuilder
    private func subtasksCard(_ subtasks: [MockSubtask]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("SUBTASKS")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.sectionLabelColor)

                Spacer()

                Text("\(subtasks.filter(\.isCompleted).count)/\(subtasks.count)")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
            }
            .padding(.horizontal, 20)

            GlassCard {
                VStack(spacing: 0) {
                    ForEach(Array(subtasks.enumerated()), id: \.element.id) { index, subtask in
                        HStack(spacing: 12) {
                            TaskCheckbox(isChecked: subtask.isCompleted) {
                                // Toggle subtask — mock only
                            }

                            Text(subtask.title)
                                .font(BrettTypography.taskTitle)
                                .foregroundStyle(subtask.isCompleted ? BrettColors.textMeta : BrettColors.textCardTitle)
                                .strikethrough(subtask.isCompleted, color: BrettColors.textGhost)

                            Spacer()
                        }
                        .padding(.vertical, 2)

                        if index < subtasks.count - 1 {
                            Divider().background(BrettColors.hairline)
                        }
                    }

                    // Add subtask row
                    Divider().background(BrettColors.hairline)
                    HStack(spacing: 12) {
                        Image(systemName: "plus")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(BrettColors.textPlaceholder)
                            .frame(width: 30, height: 30)
                        Text("Add subtask")
                            .font(BrettTypography.taskTitle)
                            .foregroundStyle(BrettColors.textPlaceholder)
                        Spacer()
                    }
                    .padding(.vertical, 4)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Brett chat card

    @ViewBuilder
    private func brettChatCard(_ item: MockItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("BRETT")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(BrettColors.ceruleanLabel)
                .padding(.horizontal, 20)

            GlassCard(tint: BrettColors.cerulean) {
                VStack(alignment: .leading, spacing: 12) {
                    // Brett's mark (dot + line)
                    HStack(spacing: 6) {
                        Circle()
                            .fill(BrettColors.gold)
                            .frame(width: 6, height: 6)
                        RoundedRectangle(cornerRadius: 1)
                            .fill(BrettColors.cerulean.opacity(0.70))
                            .frame(width: 20, height: 3)
                    }

                    Text("Ask Brett about this task...")
                        .font(BrettTypography.body)
                        .foregroundStyle(BrettColors.cerulean.opacity(0.60))
                }
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Helpers

    private func scheduleRow(icon: String, label: String, value: String, valueColor: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(BrettColors.textMeta)
                .frame(width: 20)

            Text(label)
                .font(BrettTypography.body)
                .foregroundStyle(BrettColors.textMeta)

            Spacer()

            Text(value)
                .font(BrettTypography.body)
                .foregroundStyle(valueColor)
        }
        .padding(.vertical, 11)
    }

    private func urgencyColor(for item: MockItem) -> Color {
        guard let date = item.dueDate else { return BrettColors.textMeta }
        let urgency = DateHelpers.computeUrgency(dueDate: date, isCompleted: item.isCompleted)
        switch urgency {
        case .overdue: return BrettColors.error
        case .today: return BrettColors.gold
        default: return BrettColors.textCardTitle
        }
    }

    private func commitTitle(_ item: MockItem) {
        isEditingTitle = false
        // In real app: update title via store
    }
}
