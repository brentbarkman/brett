import SwiftUI

/// Task row — compact 48pt height line with checkbox + title + metadata whisper.
///
/// Two initialisers:
///  - `init(item: MockItem, ...)` — legacy mock path, still used by Inbox and
///    anywhere else we haven't migrated off `MockStore` yet. Kept until every
///    caller flips to the real sync-backed `Item`.
///  - `init(item: Item, listName:, onToggle:, onSelect:)` — real SwiftData
///    Item. Taking the list name as a separate parameter avoids reaching into
///    `ListStore` from a leaf view and keeps the row cheap to render.
struct TaskRow: View {
    private let viewModel: ViewModel
    private let onToggle: () -> Void
    private let onSelect: () -> Void

    // MARK: - Initialisers

    init(item: MockItem, onToggle: @escaping () -> Void, onSelect: @escaping () -> Void) {
        self.viewModel = ViewModel(
            id: item.id,
            title: item.title,
            isCompleted: item.isCompleted,
            timeLabel: item.time,
            capturedLabel: item.capturedAgo,
            listName: item.listName,
            contentDomain: item.contentDomain
        )
        self.onToggle = onToggle
        self.onSelect = onSelect
    }

    init(
        item: Item,
        listName: String? = nil,
        onToggle: @escaping () -> Void,
        onSelect: @escaping () -> Void
    ) {
        self.viewModel = ViewModel(
            id: item.id,
            title: item.title,
            isCompleted: item.isCompleted,
            timeLabel: Self.timeLabel(for: item),
            capturedLabel: Self.capturedLabel(for: item),
            listName: listName,
            contentDomain: item.contentDomain
        )
        self.onToggle = onToggle
        self.onSelect = onSelect
    }

    // MARK: - Body

    var body: some View {
        Button {
            onSelect()
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(
                            viewModel.isCompleted
                                ? BrettColors.success.opacity(0.15)
                                : Color.black.opacity(0.20)
                        )
                        .overlay {
                            Circle()
                                .strokeBorder(
                                    viewModel.isCompleted
                                        ? BrettColors.success.opacity(0.4)
                                        : Color.white.opacity(0.10),
                                    lineWidth: 1
                                )
                        }
                        .frame(width: 30, height: 30)

                    if viewModel.isCompleted {
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
                    Text(viewModel.title)
                        .font(BrettTypography.taskTitle)
                        .foregroundStyle(viewModel.isCompleted ? BrettColors.textMeta : BrettColors.textCardTitle)
                        .strikethrough(viewModel.isCompleted, color: BrettColors.textGhost)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 6) {
                        if let time = viewModel.timeLabel {
                            Text(time)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        } else if let captured = viewModel.capturedLabel {
                            Text("Captured \(captured)")
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        }

                        if let listName = viewModel.listName {
                            if viewModel.timeLabel != nil || viewModel.capturedLabel != nil {
                                Text("·")
                                    .font(BrettTypography.taskMeta)
                                    .foregroundStyle(BrettColors.textGhost)
                            }
                            Text(listName)
                                .font(BrettTypography.taskMeta)
                                .foregroundStyle(BrettColors.textMeta)
                        }

                        if let domain = viewModel.contentDomain {
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
        .accessibilityLabel(accessibilityLabelText)
        .accessibilityHint("Double-tap to open details.")
        .dynamicTypeClamp()
    }

    /// VoiceOver label — built from the `ViewModel` so the announced whisper
    /// tracks the visual one (time, captured-ago, list, completion). Kept
    /// inside the row rather than in `AccessibilityLabels` because the row
    /// supports both the mock-item path and the real-Item path; routing both
    /// through the shared helper would require threading the raw `Item` in
    /// through the mock initialiser as well.
    private var accessibilityLabelText: String {
        var parts: [String] = [viewModel.title]
        if let time = viewModel.timeLabel {
            parts.append("due \(time)")
        } else if let captured = viewModel.capturedLabel {
            parts.append("captured \(captured)")
        }
        if let listName = viewModel.listName, !listName.isEmpty {
            parts.append("in \(listName) list")
        }
        parts.append(viewModel.isCompleted ? "Completed" : "Pending")
        return parts.joined(separator: ", ")
    }

    // MARK: - View model

    private struct ViewModel {
        let id: String
        let title: String
        let isCompleted: Bool
        let timeLabel: String?
        let capturedLabel: String?
        let listName: String?
        let contentDomain: String?
    }

    // MARK: - Real-Item formatters

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter
    }()

    /// Time whisper — only render when the due date carries a time-of-day
    /// (we skip midnight-only dates so the row doesn't read "12:00 AM" for
    /// every item without a precise time).
    private static func timeLabel(for item: Item) -> String? {
        guard let due = item.dueDate else { return nil }
        let comps = Calendar.current.dateComponents([.hour, .minute], from: due)
        if (comps.hour ?? 0) == 0 && (comps.minute ?? 0) == 0 { return nil }
        return timeFormatter.string(from: due).lowercased() // "9:00 am" style
    }

    private static func capturedLabel(for item: Item) -> String? {
        // "Captured {relative}" for undated content/inbox items
        guard item.dueDate == nil else { return nil }
        let elapsed = Date().timeIntervalSince(item.createdAt)
        let days = Int(elapsed / 86_400)
        if days == 0 { return "today" }
        if days == 1 { return "yesterday" }
        if days < 7 { return "\(days)d ago" }
        let weeks = days / 7
        return "\(weeks)w ago"
    }
}
