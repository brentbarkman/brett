import SwiftUI

struct GoldCheckbox: View {
    let isChecked: Bool
    let action: () -> Void

    var body: some View {
        Button(action: {
            HapticManager.light()
            action()
        }) {
            ZStack {
                Circle()
                    .strokeBorder(isChecked ? BrettColors.gold : Color.white.opacity(0.25), lineWidth: 1.5)
                    .frame(width: 22, height: 22)

                if isChecked {
                    Circle()
                        .fill(BrettColors.gold)
                        .frame(width: 22, height: 22)

                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.black)
                }
            }
        }
        .buttonStyle(.plain)
        .frame(width: 44, height: 44) // 44pt tap target
        .contentShape(Rectangle())
        .accessibilityLabel(isChecked ? "Completed" : "Not completed")
        .accessibilityHint("Double-tap to toggle")
    }
}
