import SwiftUI

struct ListDrawer: View {
    @Bindable var store: MockStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("LISTS")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.5)
                        .foregroundStyle(BrettColors.textTertiary)
                        .padding(.horizontal, 20)

                    // List pills
                    FlowLayout(spacing: 10) {
                        ForEach(store.lists) { list in
                            Button {
                                dismiss()
                                // Navigate to list detail — will be wired via navigation
                            } label: {
                                HStack(spacing: 8) {
                                    Circle()
                                        .fill(Color(hex: list.colorHex) ?? BrettColors.gold)
                                        .frame(width: 8, height: 8)

                                    Text(list.name)
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundStyle(BrettColors.textPrimary)

                                    Text("\(store.itemsForList(list.id).count)")
                                        .font(.system(size: 12))
                                        .foregroundStyle(BrettColors.textSecondary)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                                .background {
                                    Capsule()
                                        .fill(Color.white.opacity(0.08))
                                        .overlay {
                                            Capsule()
                                                .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
                                        }
                                }
                            }
                            .buttonStyle(.plain)
                        }

                        // Add list button
                        Button {
                            // Create list — placeholder
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "plus")
                                    .font(.system(size: 12, weight: .medium))
                                Text("New List")
                                    .font(.system(size: 14, weight: .medium))
                            }
                            .foregroundStyle(BrettColors.gold)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background {
                                Capsule()
                                    .strokeBorder(BrettColors.gold.opacity(0.3), lineWidth: 1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.top, 20)
            }
        }
    }
}

// Simple flow layout for list pills
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
    }
}
