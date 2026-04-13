import SwiftUI

struct TaskRow: View {
    let item: MockItem
    let onToggle: () -> Void
    var onTap: (() -> Void)? = nil

    var body: some View {
        Button(action: { onTap?() }) {
            HStack(spacing: 12) {
                TaskCheckbox(
                    isChecked: item.isCompleted,
                    contentType: item.type == .content ? .webPage : nil,
                    action: onToggle
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
                                .foregroundStyle(BrettColors.textMeta) // white/40 for timestamps
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
                                .foregroundStyle(BrettColors.textMeta) // white/40 for list+source
                        }

                        if let domain = item.contentDomain {
                            Text(domain)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.cerulean.opacity(0.6))
                        }
                    }
                }

                Spacer()
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title), \(item.listName ?? ""), \(item.isCompleted ? "completed" : "pending")")
        .accessibilityHint("Double-tap for details")
    }
}
