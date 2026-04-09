import SwiftUI

struct TaskDetailView: View {
    @Bindable var store: MockStore
    let itemId: String
    @Environment(\.dismiss) private var dismiss

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
                        // Title + checkbox
                        HStack(spacing: 14) {
                            GoldCheckbox(isChecked: item.isCompleted) {
                                store.toggleItem(item.id)
                            }

                            Text(item.title)
                                .font(BrettTypography.detailTitle)
                                .foregroundStyle(.white)
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 20)

                        // Details card
                        GlassCard {
                            VStack(spacing: 0) {
                                detailRow(label: "Due", value: item.dueDate.map { DateHelpers.formatRelativeDate($0) } ?? "None")

                                Divider().background(BrettColors.hairline)

                                detailRow(label: "List", value: item.listName ?? "None", valueColor: BrettColors.gold)

                                Divider().background(BrettColors.hairline)

                                detailRow(label: "Reminder", value: "None")

                                Divider().background(BrettColors.hairline)

                                detailRow(label: "Recurrence", value: "None")
                            }
                        }
                        .padding(.horizontal, 16)

                        // Notes card
                        if let notes = item.notes, !notes.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("NOTES")
                                    .font(.system(size: 11, weight: .semibold))
                                    .tracking(1.5)
                                    .foregroundStyle(BrettColors.textTertiary)
                                    .padding(.horizontal, 20)

                                GlassCard {
                                    Text(notes)
                                        .font(BrettTypography.body)
                                        .foregroundStyle(Color.white.opacity(0.70))
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .padding(.horizontal, 16)
                            }
                        }

                        // Subtasks card
                        if !item.subtasks.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("SUBTASKS")
                                    .font(.system(size: 11, weight: .semibold))
                                    .tracking(1.5)
                                    .foregroundStyle(BrettColors.textTertiary)
                                    .padding(.horizontal, 20)

                                GlassCard {
                                    VStack(spacing: 0) {
                                        ForEach(Array(item.subtasks.enumerated()), id: \.element.id) { index, subtask in
                                            HStack(spacing: 12) {
                                                GoldCheckbox(isChecked: subtask.isCompleted) { }

                                                Text(subtask.title)
                                                    .font(BrettTypography.taskTitle)
                                                    .foregroundStyle(subtask.isCompleted ? Color.white.opacity(0.35) : BrettColors.textPrimary)
                                                    .strikethrough(subtask.isCompleted, color: Color.white.opacity(0.2))

                                                Spacer()
                                            }
                                            .padding(.vertical, 4)

                                            if index < item.subtasks.count - 1 {
                                                Divider().background(BrettColors.hairline)
                                            }
                                        }
                                    }
                                }
                                .padding(.horizontal, 16)
                            }
                        }

                        // Brett chat prompt
                        GlassCard(tint: BrettColors.cerulean) {
                            HStack {
                                Image(systemName: "sparkle")
                                    .foregroundStyle(BrettColors.cerulean)
                                Text("Ask Brett about this task...")
                                    .font(BrettTypography.body)
                                    .foregroundStyle(BrettColors.cerulean.opacity(0.7))
                                Spacer()
                            }
                        }
                        .padding(.horizontal, 16)

                        Spacer(minLength: 40)
                    }
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
                        Text("Today")
                            .font(.system(size: 16, weight: .medium))
                    }
                    .foregroundStyle(BrettColors.gold)
                }
            }
        }
    }

    private func detailRow(label: String, value: String, valueColor: Color = BrettColors.textPrimary) -> some View {
        HStack {
            Text(label)
                .font(BrettTypography.body)
                .foregroundStyle(BrettColors.textSecondary)
            Spacer()
            Text(value)
                .font(BrettTypography.body)
                .foregroundStyle(valueColor)
        }
        .padding(.vertical, 10)
    }
}
