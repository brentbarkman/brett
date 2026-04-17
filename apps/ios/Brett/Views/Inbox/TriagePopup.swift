import SwiftUI

/// Which triage operation the popup is performing on the selected items.
enum TriageMode: Equatable {
    case schedule   // Assign a dueDate
    case move       // Assign a listId
}

/// Bottom-sheet triage popup. Hosts two modes that share the same chrome
/// (drag indicator, title, confirm/cancel) but swap their body:
///
///   • `.schedule` → quick-pick buttons (Today / Tomorrow / Next week) plus a
///     DatePicker fallback.
///   • `.move`     → horizontal scroll of the user's lists + "New list".
///
/// The caller owns `isPresented`. When the user confirms, the popup calls
/// `itemStore.bulkUpdate(ids:, changes:)` and dismisses. Cancel just dismisses.
struct TriagePopup: View {
    let mode: TriageMode
    let selectedIDs: Set<String>
    let userId: String?
    @Bindable var itemStore: ItemStore
    @Bindable var listStore: ListStore
    @Binding var isPresented: Bool
    /// Caller hook — fires after a confirm so InboxPage can reset selection.
    let onCommit: () -> Void

    // MARK: - Local mode state
    @State private var pickedDate: Date = Calendar.current.startOfDay(for: Date())
    @State private var showingCustomDatePicker: Bool = false
    @State private var newListName: String = ""
    @State private var creatingList: Bool = false

    private var lists: [ItemList] {
        listStore.fetchAll()
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            Divider().background(BrettColors.cardBorder)

            ScrollView {
                switch mode {
                case .schedule: scheduleBody
                case .move: moveBody
                }
            }
        }
        .background(Color.black.opacity(0.85))
        .accessibilityElement(children: .contain)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button("Cancel") {
                HapticManager.light()
                isPresented = false
            }
            .font(.system(size: 14, weight: .regular))
            .foregroundStyle(Color.white.opacity(0.60))

            Spacer()

            Text(mode == .schedule ? "Schedule" : "Move to list")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)

            Spacer()

            // Invisible spacer to balance the Cancel button
            Text("Cancel")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(.clear)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Schedule body

    private var scheduleBody: some View {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        let tomorrow = cal.date(byAdding: .day, value: 1, to: today) ?? today
        let nextWeek = cal.date(byAdding: .day, value: 7, to: today) ?? today

        return VStack(spacing: 12) {
            quickDateButton(label: "Today", date: today)
            quickDateButton(label: "Tomorrow", date: tomorrow)
            quickDateButton(label: "Next week", date: nextWeek)

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showingCustomDatePicker.toggle()
                }
            } label: {
                HStack {
                    Image(systemName: "calendar")
                        .foregroundStyle(BrettColors.gold.opacity(0.8))
                    Text("Pick a date…")
                        .foregroundStyle(Color.white.opacity(0.80))
                    Spacer()
                    Image(systemName: showingCustomDatePicker ? "chevron.up" : "chevron.down")
                        .foregroundStyle(Color.white.opacity(0.40))
                }
                .font(.system(size: 15, weight: .medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
                .background {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.white.opacity(0.05))
                }
            }
            .buttonStyle(.plain)

            if showingCustomDatePicker {
                DatePicker(
                    "Due date",
                    selection: $pickedDate,
                    in: Date()...,
                    displayedComponents: [.date]
                )
                .datePickerStyle(.graphical)
                .tint(BrettColors.gold)
                .padding(.horizontal, 8)

                Button {
                    commitSchedule(date: pickedDate)
                } label: {
                    Text("Schedule")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(BrettColors.gold, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
    }

    private func quickDateButton(label: String, date: Date) -> some View {
        Button {
            commitSchedule(date: date)
        } label: {
            HStack {
                Text(label)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white)
                Spacer()
                Text(shortDate(date))
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(Color.white.opacity(0.50))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
            .background {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.white.opacity(0.05))
            }
        }
        .buttonStyle(.plain)
    }

    private func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d"
        return formatter.string(from: date)
    }

    // MARK: - Move body

    private var moveBody: some View {
        VStack(spacing: 12) {
            if lists.isEmpty && !creatingList {
                Text("You don't have any lists yet. Create one below.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.white.opacity(0.50))
                    .multilineTextAlignment(.center)
                    .padding(.vertical, 16)
            } else {
                ForEach(lists, id: \.id) { list in
                    Button {
                        commitMove(listId: list.id)
                    } label: {
                        HStack {
                            Circle()
                                .fill(listSwatch(list))
                                .frame(width: 10, height: 10)
                            Text(list.name)
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(.white)
                            Spacer()
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 14)
                        .background {
                            RoundedRectangle(cornerRadius: 10)
                                .fill(Color.white.opacity(0.05))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            // New list creator
            if creatingList {
                HStack(spacing: 8) {
                    TextField("List name", text: $newListName)
                        .textFieldStyle(.plain)
                        .font(.system(size: 15))
                        .foregroundStyle(.white)
                        .tint(BrettColors.gold)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 12)
                        .background {
                            RoundedRectangle(cornerRadius: 10)
                                .fill(Color.white.opacity(0.05))
                        }

                    Button {
                        createAndMove()
                    } label: {
                        Text("Create")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .background(BrettColors.gold, in: RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    .disabled(newListName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } else {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { creatingList = true }
                } label: {
                    HStack {
                        Image(systemName: "plus")
                        Text("New list")
                        Spacer()
                    }
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(BrettColors.gold)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 14)
                    .background {
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(BrettColors.gold.opacity(0.25), lineWidth: 0.5)
                            .background {
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(BrettColors.gold.opacity(0.05))
                            }
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
    }

    private func listSwatch(_ list: ItemList) -> Color {
        // Resolve the stored colorClass token like "bg-blue-500" via the
        // canonical `ListColor` enum so we stay consistent with list pickers
        // elsewhere. Falls back to slate (neutral) rather than cerulean —
        // cerulean is Brett AI only, never a fallback for "some color."
        if let color = ListColor(colorClass: list.colorClass) {
            return color.swiftUIColor
        }
        return ListColor.slate.swiftUIColor
    }

    // MARK: - Commits

    private func commitSchedule(date: Date) {
        HapticManager.heavy()
        itemStore.bulkUpdate(
            ids: Array(selectedIDs),
            changes: ["dueDate": date]
        )
        isPresented = false
        onCommit()
    }

    private func commitMove(listId: String) {
        HapticManager.heavy()
        itemStore.bulkUpdate(
            ids: Array(selectedIDs),
            changes: ["listId": listId]
        )
        isPresented = false
        onCommit()
    }

    private func createAndMove() {
        let trimmed = newListName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let userId, !userId.isEmpty else { return }
        let list = listStore.create(userId: userId, name: trimmed)
        commitMove(listId: list.id)
    }
}
