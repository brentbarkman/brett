import SwiftUI

/// Matches the desktop's dark glass circle with icon inside.
/// Unchecked: dark glass circle with bolt icon (task) or content icon.
/// Checked: teal-tinted circle with checkmark.
struct TaskCheckbox: View {
    let isChecked: Bool
    var contentType: ContentType? = nil
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
        .accessibilityLabel(isChecked ? "Completed" : "Not completed")
        .accessibilityHint("Double-tap to toggle")
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
