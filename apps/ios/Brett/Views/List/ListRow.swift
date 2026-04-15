import SwiftUI

/// A single list pill — colored dot + list name + count badge, wrapped in a
/// glass capsule. Reused by the list drawer and anywhere else we want to
/// surface a list entry inline.
struct ListRow: View {
    let name: String
    let color: ListColor
    let count: Int
    var isArchived: Bool = false

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(color.swiftUIColor)
                .frame(width: 8, height: 8)
                .opacity(isArchived ? 0.35 : 1)

            Text(name)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(
                    isArchived ? BrettColors.textMeta : BrettColors.textCardTitle
                )
                .lineLimit(1)

            if count > 0 {
                Text("\(count)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(
                        isArchived
                            ? BrettColors.textGhost
                            : BrettColors.gold.opacity(0.85)
                    )
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background {
                        Capsule()
                            .fill(
                                isArchived
                                    ? Color.white.opacity(0.05)
                                    : BrettColors.gold.opacity(0.12)
                            )
                    }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background {
            Capsule()
                .fill(Color.white.opacity(isArchived ? 0.05 : 0.10))
                .overlay {
                    Capsule()
                        .strokeBorder(Color.white.opacity(0.05), lineWidth: 0.5)
                }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(name)\(count > 0 ? ", \(count) items" : "")\(isArchived ? ", archived" : "")"
        )
    }
}
