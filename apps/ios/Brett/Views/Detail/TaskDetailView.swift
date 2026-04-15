import SwiftUI

struct TaskDetailView: View {
    @Bindable var store: MockStore
    let itemId: String
    @Environment(\.dismiss) private var dismiss

    @State private var isEditingTitle = false
    @State private var titleDraft = ""
    @State private var isEditingNotes = false
    @State private var notesDraft = ""
    @State private var isBrettExpanded = false
    @State private var brettInput = ""
    @State private var linkSearchText = ""
    @State private var isSearchingLinks = false
    @FocusState private var isTitleFocused: Bool
    @FocusState private var isNotesFocused: Bool
    @FocusState private var isBrettFocused: Bool

    // On a solid dark surface (no material), theme colors need boosting.
    // These override BrettColors values that assume glass/material behind them.
    private let sectionLabel = Color.white.opacity(0.60)
    private let metaText = Color.white.opacity(0.50)
    private let placeholder = Color.white.opacity(0.40)
    private let dimIcon = Color.white.opacity(0.30)

    private var item: MockItem? {
        store.items.first(where: { $0.id == itemId }) ??
        store.inboxItems.first(where: { $0.id == itemId })
    }

    var body: some View {
        if let item {
            ScrollView {
                mainCard(item)
                    .padding(.top, 12)
                    .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
        }
    }

    // MARK: - Main content card

    @ViewBuilder
    private func mainCard(_ item: MockItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header: label + complete + overflow
            headerSection(item)

            sectionDivider()

            // Title
            titleSection(item)

            sectionDivider()

            // Schedule
            scheduleSection(item)

            sectionDivider()

            // Notes
            notesSection(item)

            sectionDivider()

            // Attachments
            attachmentsSection(item)

            sectionDivider()

            // Linked Items
            linkedItemsSection(item)

            sectionDivider()

            // Brett thread — integrated as last section
            brettSection(item)
        }
    }

    // MARK: - Header

    @ViewBuilder
    private func headerSection(_ item: MockItem) -> some View {
        HStack(spacing: 8) {
            Text("TASK")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(sectionLabel)

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

            Spacer()

            Button {
                HapticManager.light()
                store.toggleItem(item.id)
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: item.isCompleted ? "checkmark.circle.fill" : "checkmark.circle")
                        .font(.system(size: 12, weight: .medium))
                    Text(item.isCompleted ? "Done" : "Complete")
                        .font(.system(size: 12, weight: .medium))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .foregroundStyle(item.isCompleted ? BrettColors.success : Color.white.opacity(0.60))
                .background(
                    (item.isCompleted ? BrettColors.success : Color.white).opacity(item.isCompleted ? 0.15 : 0.10),
                    in: Capsule()
                )
                .overlay {
                    Capsule().strokeBorder(
                        (item.isCompleted ? BrettColors.success : Color.white).opacity(item.isCompleted ? 0.30 : 0.10),
                        lineWidth: 0.5
                    )
                }
            }

            overflowMenu(item)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Title

    @ViewBuilder
    private func titleSection(_ item: MockItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if isEditingTitle {
                TextField("Task title", text: $titleDraft)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white)
                    .tint(BrettColors.gold)
                    .focused($isTitleFocused)
                    .submitLabel(.done)
                    .onSubmit { isEditingTitle = false }
                    .onAppear {
                        titleDraft = item.title
                        isTitleFocused = true
                    }
            } else {
                Text(item.title)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(item.isCompleted ? metaText : .white)
                    .strikethrough(item.isCompleted, color: BrettColors.textGhost)
                    .lineSpacing(2)
                    .onTapGesture {
                        isEditingTitle = true
                        titleDraft = item.title
                    }
            }

            // Metadata row
            if let time = item.time {
                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(.system(size: 11, weight: .medium))
                    Text(time)
                        .font(BrettTypography.taskMeta)
                }
                .foregroundStyle(metaText)
                .padding(.top, 6)
            }

            if let listName = item.listName {
                HStack(spacing: 6) {
                    Image(systemName: "folder")
                        .font(.system(size: 11, weight: .medium))
                    Text(listName)
                        .font(BrettTypography.taskMeta)
                }
                .foregroundStyle(metaText)
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    // MARK: - Schedule

    @ViewBuilder
    private func scheduleSection(_ item: MockItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("SCHEDULE")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(sectionLabel)

            HStack(spacing: 8) {
                dueDateMenu(item)
                reminderMenu(item)
                recurrenceMenu(item)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    @ViewBuilder
    private func scheduleMiniCard(icon: String, label: String, value: String, isSet: Bool, accentColor: Color) -> some View {
        VStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(isSet ? accentColor.opacity(0.80) : metaText)

            Text(label)
                .font(.system(size: 8, weight: .semibold))
                .tracking(1.5)
                .foregroundStyle(sectionLabel)

            Text(value)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(isSet ? accentColor : Color.white.opacity(0.30))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .padding(.horizontal, 6)
        .background {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.10))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                }
        }
    }

    // MARK: - Notes

    @ViewBuilder
    private func notesSection(_ item: MockItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("NOTES")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(sectionLabel)

            if isEditingNotes {
                TextEditor(text: $notesDraft)
                    .font(BrettTypography.body)
                    .foregroundStyle(BrettColors.textBody)
                    .scrollContentBackground(.hidden)
                    .focused($isNotesFocused)
                    .frame(minHeight: 80)
                    .tint(BrettColors.gold)
                    .padding(10)
                    .background {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white.opacity(0.05))
                    }
                    .onAppear {
                        notesDraft = item.notes ?? ""
                        isNotesFocused = true
                    }
            } else if let notes = item.notes, !notes.isEmpty {
                Text(notes)
                    .font(BrettTypography.body)
                    .foregroundStyle(BrettColors.textBody)
                    .lineSpacing(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture { isEditingNotes = true }
            } else {
                Text("Add notes\u{2026}")
                    .font(BrettTypography.body)
                    .foregroundStyle(placeholder)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onTapGesture { isEditingNotes = true }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    // MARK: - Attachments

    @ViewBuilder
    private func attachmentsSection(_ item: MockItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("ATTACHMENTS")
                .font(BrettTypography.sectionLabel)
                .tracking(2.4)
                .foregroundStyle(sectionLabel)

            if !item.attachments.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(item.attachments.enumerated()), id: \.element.id) { index, attachment in
                        HStack(spacing: 12) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(Color.white.opacity(0.10))
                                    .frame(width: 34, height: 34)

                                Image(systemName: attachmentIcon(attachment.mimeType))
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(attachmentColor(attachment.mimeType))
                            }

                            VStack(alignment: .leading, spacing: 2) {
                                Text(attachment.filename)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(BrettColors.textCardTitle)
                                    .lineLimit(1)
                                Text(attachment.sizeLabel)
                                    .font(.system(size: 11))
                                    .foregroundStyle(metaText)
                            }

                            Spacer()

                            Button {} label: {
                                Image(systemName: "xmark")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(Color.white.opacity(0.30))
                            }
                        }
                        .padding(.vertical, 6)

                        if index < item.attachments.count - 1 {
                            Divider().background(BrettColors.hairline)
                        }
                    }
                }
            }

            // Upload zone
            Button {} label: {
                HStack(spacing: 8) {
                    Image(systemName: "paperclip")
                        .font(.system(size: 13, weight: .medium))
                    Text("Tap to attach a file")
                        .font(.system(size: 12, weight: .medium))
                }
                .foregroundStyle(Color.white.opacity(0.30))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.10), style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    // MARK: - Linked Items

    @ViewBuilder
    private func linkedItemsSection(_ item: MockItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("LINKED ITEMS")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(sectionLabel)

                Spacer()

                Button {
                    withAnimation(.easeOut(duration: 0.2)) {
                        isSearchingLinks.toggle()
                    }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(metaText)
                        .frame(width: 22, height: 22)
                        .background(Color.white.opacity(0.10), in: Circle())
                }
            }

            if isSearchingLinks {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.30))
                    TextField("Search items\u{2026}", text: $linkSearchText)
                        .font(.system(size: 13))
                        .foregroundStyle(.white)
                        .tint(BrettColors.gold)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.white.opacity(0.05))
                        .overlay {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                        }
                }
            }

            if !item.linkedItems.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(item.linkedItems.enumerated()), id: \.element.id) { index, linked in
                        HStack(spacing: 10) {
                            Image(systemName: linked.type == .task ? "bolt.fill" : "book")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(linked.type == .task ? BrettColors.gold : BrettColors.amber400.opacity(0.8))

                            Text(linked.title)
                                .font(.system(size: 13))
                                .foregroundStyle(BrettColors.textBody)
                                .lineLimit(1)

                            Spacer()

                            if linked.source == "embedding" {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(BrettColors.amber400.opacity(0.50))
                            }

                            Button {} label: {
                                Image(systemName: "xmark")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(Color.white.opacity(0.30))
                            }
                        }
                        .padding(.vertical, 6)

                        if index < item.linkedItems.count - 1 {
                            Divider().background(BrettColors.hairline)
                        }
                    }
                }
            } else if !isSearchingLinks {
                HStack(spacing: 6) {
                    Image(systemName: "link")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(dimIcon)
                    Text("No linked items")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.white.opacity(0.30))
                }
                .padding(.vertical, 8)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    // MARK: - Brett Section (integrated)

    @ViewBuilder
    private func brettSection(_ item: MockItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            // Section header with Brett mark
            HStack(spacing: 8) {
                HStack(spacing: 4) {
                    Circle()
                        .fill(BrettColors.gold)
                        .frame(width: 5, height: 5)
                    RoundedRectangle(cornerRadius: 1)
                        .fill(BrettColors.cerulean.opacity(0.60))
                        .frame(width: 16, height: 2.5)
                }

                Text("BRETT")
                    .font(BrettTypography.sectionLabel)
                    .tracking(2.4)
                    .foregroundStyle(BrettColors.cerulean.opacity(0.60))

                Spacer()
            }

            // Message history
            if !item.brettMessages.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(item.brettMessages) { message in
                        if message.role == "user" {
                            HStack {
                                Spacer(minLength: 60)
                                Text(message.content)
                                    .font(.system(size: 13))
                                    .foregroundStyle(Color.white.opacity(0.90))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(
                                        Color.white.opacity(0.10),
                                        in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    )
                            }
                        } else {
                            Text(message.content)
                                .font(.system(size: 13))
                                .foregroundStyle(Color.white.opacity(0.80))
                                .lineSpacing(3)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(
                                    BrettColors.cerulean.opacity(0.10),
                                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                                )
                        }
                    }
                }
            }

            // Input — always visible
            HStack(spacing: 8) {
                TextField("Ask Brett about this task\u{2026}", text: $brettInput)
                    .font(.system(size: 13))
                    .foregroundStyle(.white)
                    .tint(BrettColors.cerulean)
                    .focused($isBrettFocused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(
                        Color.white.opacity(0.05),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                    }

                Button {} label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(BrettColors.gold, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .opacity(brettInput.trimmingCharacters(in: .whitespaces).isEmpty ? 0.25 : 1.0)
                .disabled(brettInput.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    // MARK: - Helpers

    @ViewBuilder
    private func sectionDivider() -> some View {
        Rectangle()
            .fill(Color.white.opacity(0.10))
            .frame(height: 0.5)
            .padding(.horizontal, 16)
    }

    @ViewBuilder
    private func overflowMenu(_ item: MockItem) -> some View {
        Menu {
            Button {
                store.toggleItem(item.id)
            } label: {
                Label(
                    item.isCompleted ? "Mark Incomplete" : "Complete",
                    systemImage: item.isCompleted ? "arrow.uturn.backward" : "checkmark.circle"
                )
            }
            Button {} label: { Label("Duplicate", systemImage: "doc.on.doc") }
            Button {} label: { Label("Move to List", systemImage: "folder") }
            Button {} label: { Label("Copy Link", systemImage: "link") }
            Divider()
            Button(role: .destructive) {} label: { Label("Delete", systemImage: "trash") }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.40))
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
    }

    @ViewBuilder
    private func dueDateMenu(_ item: MockItem) -> some View {
        Menu {
            Button {} label: { Label("Today", systemImage: "") }
            Button {} label: { Label("Tomorrow", systemImage: "") }
            Button {} label: { Label("This Week", systemImage: "") }
            Divider()
            Button {} label: { Label("No date", systemImage: "") }
        } label: {
            scheduleMiniCard(
                icon: "calendar",
                label: "DUE DATE",
                value: item.dueDate.map { DateHelpers.formatRelativeDate($0) } ?? "Not set",
                isSet: item.dueDate != nil,
                accentColor: urgencyColor(for: item)
            )
        }
    }

    @ViewBuilder
    private func reminderMenu(_ item: MockItem) -> some View {
        Menu {
            Button {} label: { Label("Morning of", systemImage: "") }
            Button {} label: { Label("1 hour before", systemImage: "") }
            Button {} label: { Label("Day before", systemImage: "") }
            Divider()
            Button {} label: { Label("No reminder", systemImage: "") }
        } label: {
            scheduleMiniCard(
                icon: "bell",
                label: "REMINDER",
                value: item.reminder.map { reminderLabel($0) } ?? "Not set",
                isSet: item.reminder != nil,
                accentColor: BrettColors.textCardTitle
            )
        }
    }

    @ViewBuilder
    private func recurrenceMenu(_ item: MockItem) -> some View {
        Menu {
            Button {} label: { Label("Daily", systemImage: "") }
            Button {} label: { Label("Weekly", systemImage: "") }
            Button {} label: { Label("Monthly", systemImage: "") }
            Divider()
            Button {} label: { Label("No recurrence", systemImage: "") }
        } label: {
            scheduleMiniCard(
                icon: "repeat",
                label: "RECURRENCE",
                value: item.recurrence.map { $0.rawValue.capitalized } ?? "Not set",
                isSet: item.recurrence != nil,
                accentColor: BrettColors.gold
            )
        }
    }

    private func urgencyColor(for item: MockItem) -> Color {
        guard let date = item.dueDate else { return Color.white.opacity(0.30) }
        let urgency = DateHelpers.computeUrgency(dueDate: date, isCompleted: item.isCompleted)
        switch urgency {
        case .overdue: return BrettColors.error
        case .today: return BrettColors.gold
        default: return BrettColors.textCardTitle
        }
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
        return metaText
    }
}
