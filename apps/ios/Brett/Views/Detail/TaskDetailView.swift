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
                    VStack(alignment: .leading, spacing: 20) {
                        // MARK: - Header
                        headerSection(item)

                        // MARK: - Title + checkbox
                        titleSection(item)

                        // MARK: - List pill
                        if let listName = item.listName {
                            listPill(listName, colorHex: store.lists.first(where: { $0.id == item.listId })?.colorHex)
                        }

                        // MARK: - Schedule row (3 mini cards)
                        scheduleRow(item)

                        // MARK: - Notes
                        if let notes = item.notes, !notes.isEmpty {
                            notesSection(notes)
                        }

                        // MARK: - Subtasks
                        if !item.subtasks.isEmpty {
                            subtasksSection(item.subtasks)
                        }

                        // MARK: - Attachments
                        if !item.attachments.isEmpty {
                            attachmentsSection(item.attachments)
                        }

                        // MARK: - Linked Items
                        if !item.linkedItems.isEmpty {
                            linkedItemsSection(item.linkedItems)
                        }

                        // MARK: - Brett Thread
                        brettSection(item)

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
                    HStack(spacing: 4) {
                        // Complete toggle
                        Button {
                            HapticManager.light()
                            store.toggleItem(item.id)
                        } label: {
                            Image(systemName: item.isCompleted ? "checkmark.circle.fill" : "checkmark.circle")
                                .font(.system(size: 18, weight: .medium))
                                .foregroundStyle(item.isCompleted ? BrettColors.success : Color.white.opacity(0.40))
                        }

                        // Overflow menu
                        Menu {
                            Button {
                                store.toggleItem(item.id)
                            } label: {
                                Label(
                                    item.isCompleted ? "Mark Incomplete" : "Complete",
                                    systemImage: item.isCompleted ? "arrow.uturn.backward" : "checkmark.circle"
                                )
                            }

                            Button {} label: {
                                Label("Duplicate", systemImage: "doc.on.doc")
                            }

                            Button {} label: {
                                Label("Move to List", systemImage: "folder")
                            }

                            Button {} label: {
                                Label("Copy Link", systemImage: "link")
                            }

                            Divider()

                            Button(role: .destructive) {} label: {
                                Label("Delete", systemImage: "trash")
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.40))
                                .frame(width: 32, height: 32)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Header: label + recurrence badge + status

    @ViewBuilder
    private func headerSection(_ item: MockItem) -> some View {
        HStack(spacing: 8) {
            Text("TASK")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(BrettColors.sectionLabelColor)

            if let recurrence = item.recurrence {
                HStack(spacing: 4) {
                    Image(systemName: "repeat")
                        .font(.system(size: 9, weight: .semibold))
                    Text(recurrence.rawValue.uppercased())
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                }
                .foregroundStyle(BrettColors.gold)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(BrettColors.gold.opacity(0.15), in: Capsule())
            }

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

    // MARK: - Title (tap to edit) with checkbox

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

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
    }

    // MARK: - List pill

    @ViewBuilder
    private func listPill(_ name: String, colorHex: String?) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(BrettColors.fromHex(colorHex ?? "#3B82F6") ?? BrettColors.cerulean)
                .frame(width: 8, height: 8)

            Text(name)
                .font(BrettTypography.badge)
                .foregroundStyle(BrettColors.textSecondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.white.opacity(0.05), in: Capsule())
        .overlay {
            Capsule().strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Schedule row: 3 mini glass cards side by side

    @ViewBuilder
    private func scheduleRow(_ item: MockItem) -> some View {
        HStack(spacing: 8) {
            scheduleMiniCard(
                icon: "calendar",
                label: "Due Date",
                value: item.dueDate.map { DateHelpers.formatRelativeDate($0) } ?? "Not set",
                valueColor: urgencyColor(for: item)
            )

            scheduleMiniCard(
                icon: "bell",
                label: "Reminder",
                value: item.reminder.map { reminderLabel($0) } ?? "Not set",
                valueColor: item.reminder != nil ? BrettColors.textCardTitle : BrettColors.textMeta
            )

            scheduleMiniCard(
                icon: "repeat",
                label: "Recurrence",
                value: item.recurrence.map { $0.rawValue.capitalized } ?? "Not set",
                valueColor: item.recurrence != nil ? BrettColors.gold : BrettColors.textMeta
            )
        }
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private func scheduleMiniCard(icon: String, label: String, value: String, valueColor: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(BrettColors.textMeta)

            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(BrettColors.textMeta)

            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(valueColor)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.white.opacity(0.05))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                }
        }
    }

    // MARK: - Notes

    @ViewBuilder
    private func notesSection(_ notes: String) -> some View {
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

    // MARK: - Subtasks

    @ViewBuilder
    private func subtasksSection(_ subtasks: [MockSubtask]) -> some View {
        let done = subtasks.filter(\.isCompleted).count

        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("SUBTASKS")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.sectionLabelColor)

                Spacer()

                Text("\(done)/\(subtasks.count)")
                    .font(BrettTypography.taskMeta)
                    .foregroundStyle(BrettColors.textMeta)
            }
            .padding(.horizontal, 20)

            GlassCard {
                VStack(spacing: 0) {
                    ForEach(Array(subtasks.enumerated()), id: \.element.id) { index, subtask in
                        HStack(spacing: 12) {
                            // Mini checkbox
                            ZStack {
                                Circle()
                                    .fill(
                                        subtask.isCompleted
                                            ? BrettColors.success.opacity(0.15)
                                            : Color.black.opacity(0.20)
                                    )
                                    .overlay {
                                        Circle()
                                            .strokeBorder(
                                                subtask.isCompleted
                                                    ? BrettColors.success.opacity(0.40)
                                                    : Color.white.opacity(0.10),
                                                lineWidth: 1
                                            )
                                    }
                                    .frame(width: 22, height: 22)

                                if subtask.isCompleted {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(BrettColors.success)
                                }
                            }

                            Text(subtask.title)
                                .font(BrettTypography.taskTitle)
                                .foregroundStyle(subtask.isCompleted ? BrettColors.textMeta : BrettColors.textCardTitle)
                                .strikethrough(subtask.isCompleted, color: BrettColors.textGhost)

                            Spacer()
                        }
                        .padding(.vertical, 6)

                        if index < subtasks.count - 1 {
                            Divider().background(BrettColors.hairline)
                        }
                    }

                    // Add subtask row
                    Divider().background(BrettColors.hairline)

                    HStack(spacing: 12) {
                        Image(systemName: "plus")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(BrettColors.textPlaceholder)
                            .frame(width: 22, height: 22)

                        Text("Add subtask")
                            .font(BrettTypography.body)
                            .foregroundStyle(BrettColors.textPlaceholder)

                        Spacer()
                    }
                    .padding(.vertical, 6)
                }
            }
            .padding(.horizontal, 16)

            // Progress bar
            GeometryReader { geo in
                let progress = subtasks.isEmpty ? 0 : CGFloat(done) / CGFloat(subtasks.count)

                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(Color.white.opacity(0.10))
                        .frame(height: 3)

                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(BrettColors.success)
                        .frame(width: geo.size.width * progress, height: 3)
                }
            }
            .frame(height: 3)
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Attachments

    @ViewBuilder
    private func attachmentsSection(_ attachments: [MockAttachment]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ATTACHMENTS")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(BrettColors.sectionLabelColor)
                .padding(.horizontal, 20)

            GlassCard {
                VStack(spacing: 0) {
                    ForEach(Array(attachments.enumerated()), id: \.element.id) { index, attachment in
                        HStack(spacing: 12) {
                            // File type icon
                            ZStack {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color.white.opacity(0.05))
                                    .frame(width: 36, height: 36)

                                Image(systemName: attachmentIcon(attachment.mimeType))
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundStyle(attachmentColor(attachment.mimeType))
                            }

                            VStack(alignment: .leading, spacing: 2) {
                                Text(attachment.filename)
                                    .font(BrettTypography.taskTitle)
                                    .foregroundStyle(BrettColors.textCardTitle)
                                    .lineLimit(1)

                                Text(attachment.sizeLabel)
                                    .font(BrettTypography.taskMeta)
                                    .foregroundStyle(BrettColors.textMeta)
                            }

                            Spacer()

                            Image(systemName: "arrow.down.circle")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(BrettColors.textGhost)
                        }
                        .padding(.vertical, 4)

                        if index < attachments.count - 1 {
                            Divider().background(BrettColors.hairline)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Linked Items

    @ViewBuilder
    private func linkedItemsSection(_ linkedItems: [MockLinkedItem]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("LINKED ITEMS")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.sectionLabelColor)

                Spacer()

                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(BrettColors.textMeta)
            }
            .padding(.horizontal, 20)

            GlassCard {
                VStack(spacing: 0) {
                    ForEach(Array(linkedItems.enumerated()), id: \.element.id) { index, linked in
                        HStack(spacing: 10) {
                            Image(systemName: linked.type == .task ? "bolt.fill" : "book")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(linked.type == .task ? BrettColors.gold : BrettColors.cerulean)

                            Text(linked.title)
                                .font(BrettTypography.body)
                                .foregroundStyle(BrettColors.textCardTitle)
                                .lineLimit(1)

                            Spacer()

                            if linked.source == "embedding" {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(BrettColors.gold.opacity(0.60))
                            }
                        }
                        .padding(.vertical, 6)

                        if index < linkedItems.count - 1 {
                            Divider().background(BrettColors.hairline)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Brett Thread

    @ViewBuilder
    private func brettSection(_ item: MockItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("BRETT")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(BrettColors.ceruleanLabel)
                .padding(.horizontal, 20)

            GlassCard(tint: BrettColors.cerulean) {
                VStack(alignment: .leading, spacing: 12) {
                    // Brett's mark
                    HStack(spacing: 6) {
                        Circle()
                            .fill(BrettColors.gold)
                            .frame(width: 6, height: 6)
                        RoundedRectangle(cornerRadius: 1)
                            .fill(BrettColors.cerulean.opacity(0.60))
                            .frame(width: 20, height: 3)
                    }

                    if item.brettMessages.isEmpty {
                        Text("Ask Brett about this task...")
                            .font(BrettTypography.body)
                            .foregroundStyle(BrettColors.cerulean.opacity(0.60))
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(item.brettMessages) { message in
                                if message.role == "user" {
                                    HStack {
                                        Spacer(minLength: 40)
                                        Text(message.content)
                                            .font(BrettTypography.body)
                                            .foregroundStyle(Color.white.opacity(0.90))
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 8)
                                            .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    }
                                } else {
                                    Text(message.content)
                                        .font(BrettTypography.body)
                                        .foregroundStyle(BrettColors.textBody)
                                        .lineSpacing(3)
                                }
                            }
                        }

                        Divider().background(BrettColors.hairline)

                        HStack(spacing: 8) {
                            Text("Ask Brett...")
                                .font(BrettTypography.body)
                                .foregroundStyle(BrettColors.cerulean.opacity(0.40))

                            Spacer()

                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 20))
                                .foregroundStyle(BrettColors.cerulean.opacity(0.30))
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    // MARK: - Helpers

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
    }

    private func reminderLabel(_ reminder: ReminderType) -> String {
        switch reminder {
        case .morningOf: return "Morning of"
        case .oneHourBefore: return "1hr before"
        case .dayBefore: return "Day before"
        case .custom: return "Custom"
        }
    }

    private func attachmentIcon(_ mimeType: String) -> String {
        if mimeType.hasPrefix("image/") { return "photo" }
        if mimeType.contains("pdf") { return "doc.text" }
        if mimeType.hasPrefix("video/") { return "film" }
        if mimeType.hasPrefix("audio/") { return "headphones" }
        return "doc"
    }

    private func attachmentColor(_ mimeType: String) -> Color {
        if mimeType.hasPrefix("image/") { return BrettColors.cerulean }
        if mimeType.contains("pdf") { return BrettColors.error }
        if mimeType.hasPrefix("video/") { return BrettColors.purple400 }
        return BrettColors.textMeta
    }
}
