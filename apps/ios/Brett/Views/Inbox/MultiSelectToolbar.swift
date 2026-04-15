import SwiftUI

/// Which triage sheet the toolbar wants to open.
enum MultiSelectAction {
    case schedule
    case move
}

/// Glass pill toolbar that rides above the omnibar whenever at least one Inbox
/// row is selected. Matches the three-action pattern from the desktop's
/// multi-select bar: Schedule, Move, Delete, with Cancel on the leading edge.
///
/// Layout is a tall glass capsule sitting inside a `.safeAreaInset(.bottom)`
/// stack so it doesn't fight the tab page's scroll geometry and naturally
/// clears the home indicator.
struct MultiSelectToolbar: View {
    let selectedCount: Int
    let onCancel: () -> Void
    let onAction: (MultiSelectAction) -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            // Leading — cancel + count
            Button {
                HapticManager.light()
                onCancel()
            } label: {
                Text("Cancel")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.60))
                    .frame(minWidth: 60, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel selection")

            Spacer(minLength: 4)

            Text("\(selectedCount) selected")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.80))
                .monospacedDigit()
                .accessibilityLabel("\(selectedCount) items selected")

            Spacer(minLength: 4)

            // Trailing — action buttons
            HStack(spacing: 4) {
                actionButton(
                    icon: "calendar",
                    label: "Schedule",
                    tint: BrettColors.gold
                ) {
                    HapticManager.medium()
                    onAction(.schedule)
                }

                actionButton(
                    icon: "folder",
                    label: "Move",
                    tint: BrettColors.cerulean
                ) {
                    HapticManager.medium()
                    onAction(.move)
                }

                actionButton(
                    icon: "trash",
                    label: "Delete",
                    tint: BrettColors.error
                ) {
                    HapticManager.heavy()
                    onDelete()
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background {
            Capsule(style: .continuous)
                .fill(.ultraThinMaterial)
                .overlay {
                    Capsule(style: .continuous)
                        .strokeBorder(Color.white.opacity(0.10), lineWidth: 0.5)
                }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .contain)
    }

    private func actionButton(
        icon: String,
        label: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
