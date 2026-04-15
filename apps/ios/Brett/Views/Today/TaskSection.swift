import SwiftUI

/// A sticky-header task card for the Today page.
///
/// Hides entirely when `items` is empty — empty-card shells add visual noise
/// and break the "background visible, breathing" rhythm between sections.
struct TaskSection: View {
    let label: String
    let icon: String
    let items: [Item]
    let labelColor: Color
    var accentColor: Color? = nil
    var listNameProvider: (Item) -> String? = { _ in nil }
    var onToggle: (String) -> Void
    var onSelect: ((String) -> Void)? = nil

    @ViewBuilder
    var body: some View {
        if !items.isEmpty {
            StickyCardSection {
                HStack(spacing: 6) {
                    Image(systemName: icon)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(labelColor.opacity(0.80))

                    Text(label.uppercased())
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                        .foregroundStyle(labelColor.opacity(0.80))

                    Spacer()

                    Text("\(items.count)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(labelColor.opacity(0.50))
                }
            } content: {
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
                                    listName: listNameProvider(item),
                                    onToggle: { onToggle(item.id) },
                                    onSelect: { onSelect?(item.id) }
                                )
                                .padding(.leading, 8)
                            }
                        } else {
                            TaskRow(
                                item: item,
                                listName: listNameProvider(item),
                                onToggle: { onToggle(item.id) },
                                onSelect: { onSelect?(item.id) }
                            )
                        }

                        if index < items.count - 1 {
                            Divider().background(BrettColors.hairline)
                                .padding(.horizontal, 16)
                        }
                    }
                }
                .padding(.bottom, 8)
            }
        }
    }
}
