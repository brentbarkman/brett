import SwiftUI

struct TaskRow: View {
    let item: MockItem
    let onToggle: () -> Void

    var body: some View {
        NavigationLink(value: item.id) {
            HStack(spacing: 12) {
                // Visual-only checkbox appearance (not a button)
                ZStack {
                    Circle()
                        .fill(
                            item.isCompleted
                                ? BrettColors.success.opacity(0.15)
                                : Color.black.opacity(0.25)
                        )
                        .overlay {
                            Circle()
                                .strokeBorder(
                                    item.isCompleted
                                        ? BrettColors.success.opacity(0.4)
                                        : Color.white.opacity(0.12),
                                    lineWidth: 1
                                )
                        }
                        .frame(width: 30, height: 30)

                    if item.isCompleted {
                        Image(systemName: "checkmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(BrettColors.success)
                    } else {
                        Image(systemName: "bolt.fill")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(BrettColors.gold.opacity(0.7))
                    }
                }
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
                .highPriorityGesture(
                    TapGesture().onEnded {
                        HapticManager.light()
                        onToggle()
                    }
                )

                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(item.isCompleted ? BrettColors.textMeta : BrettColors.textCardTitle)
                        .strikethrough(item.isCompleted, color: BrettColors.textGhost)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 6) {
                        if let time = item.time {
                            Text(time)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        } else if let captured = item.capturedAgo {
                            Text("Captured \(captured)")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        }

                        if let listName = item.listName {
                            Text("·")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textGhost)
                            Text(listName)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        }

                        if let domain = item.contentDomain {
                            Text(domain)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.cerulean.opacity(0.6))
                        }
                    }
                }

                Spacer()

                // Chevron hint
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(BrettColors.textGhost)
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title), \(item.listName ?? ""), \(item.isCompleted ? "completed" : "pending")")
        .accessibilityHint("Double-tap for details")
    }
}
