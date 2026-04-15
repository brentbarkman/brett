import SwiftUI

/// Glass card exposing the always-tappable metadata of a task — due date,
/// list, reminder, recurrence. Each row reads its current value from the
/// bound `ItemDraft` and mutates it via the standard `@Binding` chain; the
/// parent (`TaskDetailView`) is responsible for persisting the diff.
///
/// We intentionally keep the rows inside a single `GlassCard` rather than
/// four separate mini-cards so the grouping reads as a single "Details"
/// block in the scroll view, matching the spec.
struct DetailsCard: View {
    @Binding var draft: ItemDraft

    /// Lists the user can pick from. Passed in (rather than queried here) so
    /// `TaskDetailView` owns the single `ListStore` fetch.
    let lists: [ItemList]

    /// Sheet state — one at a time, driven by an `enum` so the bottom sheet
    /// content is exhaustive and compiler-checked.
    @State private var activeEditor: ActiveEditor?

    enum ActiveEditor: Identifiable, Equatable {
        case dueDate
        case list
        case reminder
        case recurrence

        var id: String {
            switch self {
            case .dueDate: return "dueDate"
            case .list: return "list"
            case .reminder: return "reminder"
            case .recurrence: return "recurrence"
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionLabel("DETAILS")
                .padding(.bottom, 10)

            VStack(spacing: 0) {
                row(
                    icon: "calendar",
                    label: "Due date",
                    value: dueDateLabel,
                    accent: dueDateAccent,
                    isSet: draft.dueDate != nil
                ) { activeEditor = .dueDate }

                rowDivider()

                row(
                    icon: "folder",
                    label: "List",
                    value: listLabel,
                    accent: draft.listId != nil ? BrettColors.textCardTitle : BrettColors.textGhost,
                    isSet: draft.listId != nil
                ) { activeEditor = .list }

                rowDivider()

                row(
                    icon: "bell",
                    label: "Reminder",
                    value: reminderLabel,
                    accent: draft.reminder != nil ? BrettColors.textCardTitle : BrettColors.textGhost,
                    isSet: draft.reminder != nil
                ) { activeEditor = .reminder }

                rowDivider()

                row(
                    icon: "repeat",
                    label: "Recurrence",
                    value: recurrenceLabel,
                    accent: draft.recurrence != nil ? BrettColors.gold : BrettColors.textGhost,
                    isSet: draft.recurrence != nil
                ) { activeEditor = .recurrence }
            }
        }
        .glassCard()
        .sheet(item: $activeEditor) { editor in
            editorSheet(for: editor)
                .presentationDetents(editor == .dueDate ? [.medium] : [.fraction(0.45)])
                .presentationBackground(Color.black.opacity(0.92))
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Row

    @ViewBuilder
    private func row(
        icon: String,
        label: String,
        value: String,
        accent: Color,
        isSet: Bool,
        tap: @escaping () -> Void
    ) -> some View {
        Button(action: {
            HapticManager.light()
            tap()
        }) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(isSet ? accent.opacity(0.90) : BrettColors.textGhost)
                    .frame(width: 18)

                Text(label)
                    .font(.system(size: 13))
                    .foregroundStyle(BrettColors.textInactive)

                Spacer()

                Text(value)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(isSet ? accent : BrettColors.textPlaceholder)
                    .lineLimit(1)

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(BrettColors.textGhost)
            }
            .contentShape(Rectangle())
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func rowDivider() -> some View {
        Rectangle()
            .fill(BrettColors.hairline)
            .frame(height: 0.5)
    }

    @ViewBuilder
    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(BrettTypography.sectionLabel)
            .tracking(2.4)
            .foregroundStyle(BrettColors.sectionLabelColor)
    }

    // MARK: - Labels

    private var dueDateLabel: String {
        draft.dueDate.map(DateHelpers.formatRelativeDate) ?? "Not set"
    }

    private var dueDateAccent: Color {
        guard let due = draft.dueDate else { return BrettColors.textGhost }
        let urgency = DateHelpers.computeUrgency(dueDate: due, isCompleted: false)
        switch urgency {
        case .overdue: return BrettColors.error
        case .today: return BrettColors.gold
        default: return BrettColors.textCardTitle
        }
    }

    private var listLabel: String {
        guard let listId = draft.listId,
              let list = lists.first(where: { $0.id == listId }) else {
            return "No list"
        }
        return list.name
    }

    private var reminderLabel: String {
        guard let raw = draft.reminder,
              let value = ReminderType(rawValue: raw) else { return "None" }
        switch value {
        case .morningOf: return "Morning of"
        case .oneHourBefore: return "1 hr before"
        case .dayBefore: return "Day before"
        case .custom: return "Custom"
        }
    }

    private var recurrenceLabel: String {
        guard let raw = draft.recurrence,
              let value = RecurrenceType(rawValue: raw) else { return "None" }
        return value.rawValue.capitalized
    }

    // MARK: - Editor sheets

    @ViewBuilder
    private func editorSheet(for editor: ActiveEditor) -> some View {
        switch editor {
        case .dueDate:
            DueDateEditor(
                date: $draft.dueDate,
                dismiss: { activeEditor = nil }
            )
        case .list:
            ListPickerEditor(
                selectedId: $draft.listId,
                lists: lists,
                dismiss: { activeEditor = nil }
            )
        case .reminder:
            OptionPickerEditor(
                title: "Reminder",
                options: [
                    (nil, "None"),
                    (ReminderType.morningOf.rawValue, "Morning of"),
                    (ReminderType.oneHourBefore.rawValue, "1 hour before"),
                    (ReminderType.dayBefore.rawValue, "Day before"),
                ],
                selection: $draft.reminder,
                dismiss: { activeEditor = nil }
            )
        case .recurrence:
            OptionPickerEditor(
                title: "Recurrence",
                options: [
                    (nil, "None"),
                    (RecurrenceType.daily.rawValue, "Daily"),
                    (RecurrenceType.weekly.rawValue, "Weekly"),
                    (RecurrenceType.monthly.rawValue, "Monthly"),
                ],
                selection: $draft.recurrence,
                dismiss: { activeEditor = nil }
            )
        }
    }
}

// MARK: - Editor sheets

private struct DueDateEditor: View {
    @Binding var date: Date?
    let dismiss: () -> Void

    @State private var working: Date = Date()
    @State private var hasDate: Bool = false

    var body: some View {
        VStack(spacing: 16) {
            HStack {
                Button("Cancel", action: dismiss)
                    .foregroundStyle(BrettColors.textInactive)
                Spacer()
                Text("Due date")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
                Button("Done") {
                    date = hasDate ? working : nil
                    dismiss()
                }
                .foregroundStyle(BrettColors.gold)
                .fontWeight(.semibold)
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)

            Toggle("Has due date", isOn: $hasDate)
                .foregroundStyle(BrettColors.textBody)
                .tint(BrettColors.gold)
                .padding(.horizontal, 20)

            if hasDate {
                DatePicker(
                    "",
                    selection: $working,
                    displayedComponents: [.date, .hourAndMinute]
                )
                .datePickerStyle(.graphical)
                .tint(BrettColors.gold)
                .padding(.horizontal, 20)
            }

            Spacer(minLength: 0)
        }
        .onAppear {
            if let date {
                working = date
                hasDate = true
            } else {
                working = Date()
                hasDate = false
            }
        }
    }
}

private struct ListPickerEditor: View {
    @Binding var selectedId: String?
    let lists: [ItemList]
    let dismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Cancel", action: dismiss)
                    .foregroundStyle(BrettColors.textInactive)
                Spacer()
                Text("List")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
                Button("Done", action: dismiss)
                    .foregroundStyle(BrettColors.gold)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 12)

            ScrollView {
                VStack(spacing: 0) {
                    pickerRow(title: "No list", isSelected: selectedId == nil) {
                        selectedId = nil
                        HapticManager.light()
                    }

                    ForEach(lists, id: \.id) { list in
                        pickerRow(title: list.name, isSelected: selectedId == list.id) {
                            selectedId = list.id
                            HapticManager.light()
                        }
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    @ViewBuilder
    private func pickerRow(title: String, isSelected: Bool, tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            HStack {
                Text(title)
                    .font(.system(size: 15))
                    .foregroundStyle(BrettColors.textBody)
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(BrettColors.gold)
                }
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(BrettColors.hairline)
                .frame(height: 0.5)
        }
    }
}

private struct OptionPickerEditor: View {
    let title: String
    let options: [(String?, String)]
    @Binding var selection: String?
    let dismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Cancel", action: dismiss)
                    .foregroundStyle(BrettColors.textInactive)
                Spacer()
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
                Button("Done", action: dismiss)
                    .foregroundStyle(BrettColors.gold)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 12)

            VStack(spacing: 0) {
                ForEach(Array(options.enumerated()), id: \.offset) { _, entry in
                    let (value, label) = entry
                    Button {
                        selection = value
                        HapticManager.light()
                    } label: {
                        HStack {
                            Text(label)
                                .font(.system(size: 15))
                                .foregroundStyle(BrettColors.textBody)
                            Spacer()
                            if selection == value {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(BrettColors.gold)
                            }
                        }
                        .padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .bottom) {
                        Rectangle()
                            .fill(BrettColors.hairline)
                            .frame(height: 0.5)
                    }
                }
            }
            .padding(.horizontal, 20)

            Spacer(minLength: 0)
        }
    }
}
