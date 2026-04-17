import SwiftUI

/// Matches the desktop's dark glass circle with icon inside.
/// Unchecked: dark glass circle with bolt icon (task) or content icon.
/// Checked: teal-tinted circle with checkmark.
struct TaskCheckbox: View {
    let isChecked: Bool
    var contentType: ContentType? = nil
    /// Optional task title — when provided, lets us produce richer VoiceOver
    /// labels like "Mark Buy groceries complete" instead of a bare
    /// "Not completed". Callers without a title may omit it.
    var title: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: {
            HapticManager.light()
            action()
        }) {
            ZStack {
                // Glass circle background
                Circle()
                    .fill(
                        isChecked
                            ? BrettColors.success.opacity(0.15)
                            : Color.black.opacity(0.20)
                    )
                    .overlay {
                        Circle()
                            .strokeBorder(
                                isChecked
                                    ? BrettColors.success.opacity(0.4)
                                    : Color.white.opacity(0.10),
                                lineWidth: 1
                            )
                    }
                    .frame(width: 30, height: 30)

                // Icon inside
                if isChecked {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(BrettColors.success)
                } else if let contentType {
                    Image(systemName: contentTypeIcon(contentType))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(BrettColors.gold.opacity(0.7))
                } else {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(BrettColors.gold.opacity(0.7))
                }
            }
        }
        .buttonStyle(.plain)
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction {
            HapticManager.light()
            action()
        }
    }

    /// VoiceOver speaks the *action* the user is about to take. When we know
    /// the task title ("Mark Buy groceries complete") it's far clearer than
    /// a bare "Not completed". Fall back to the generic phrase when the
    /// title isn't wired through.
    private var accessibilityLabel: String {
        if let title, !title.isEmpty {
            return AccessibilityLabels.checkbox(title: title, isCompleted: isChecked)
        }
        return isChecked ? "Mark incomplete" : "Mark complete"
    }

    private func contentTypeIcon(_ type: ContentType) -> String {
        switch type {
        case .newsletter: return "newspaper"
        case .article: return "doc.text"
        case .video: return "play.fill"
        case .podcast: return "headphones"
        case .tweet: return "bubble.left"
        case .pdf: return "doc"
        case .webPage: return "globe"
        }
    }
}

// Keep backward compat alias
typealias GoldCheckbox = TaskCheckbox
