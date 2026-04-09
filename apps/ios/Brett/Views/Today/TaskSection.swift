import SwiftUI

struct TaskSection: View {
    let label: String
    let items: [MockItem]
    let labelColor: Color
    var accentColor: Color? = nil
    let onToggle: (String) -> Void
    let onTap: (String) -> Void

    @ViewBuilder
    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text(label.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(1.5)
                    .foregroundStyle(labelColor)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)

                GlassCard {
                    VStack(spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            if let accent = accentColor {
                                HStack(spacing: 0) {
                                    Rectangle()
                                        .fill(accent)
                                        .frame(width: 3)
                                        .clipShape(RoundedRectangle(cornerRadius: 1.5))
                                        .padding(.vertical, 4)

                                    TaskRow(
                                        item: item,
                                        onToggle: { onToggle(item.id) },
                                        onTap: { onTap(item.id) }
                                    )
                                    .padding(.leading, 8)
                                }
                            } else {
                                TaskRow(
                                    item: item,
                                    onToggle: { onToggle(item.id) },
                                    onTap: { onTap(item.id) }
                                )
                            }

                            if index < items.count - 1 {
                                Divider()
                                    .background(BrettColors.hairline)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}
