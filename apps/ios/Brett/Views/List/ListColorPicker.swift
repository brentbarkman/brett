import SwiftUI

/// Grid of color swatches — used inline inside the "New list" form and by
/// the drawer's long-press popover for recoloring an existing list.
struct ListColorPicker: View {
    let selected: ListColor
    let onSelect: (ListColor) -> Void

    private let columns = [GridItem](
        repeating: GridItem(.flexible(), spacing: 12),
        count: 5
    )

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(ListColor.pickerSwatches) { color in
                Button {
                    HapticManager.light()
                    onSelect(color)
                } label: {
                    ZStack {
                        Circle()
                            .fill(color.swiftUIColor)
                            .frame(width: 28, height: 28)

                        if color == selected {
                            Circle()
                                .strokeBorder(Color.white, lineWidth: 2)
                                .frame(width: 34, height: 34)
                        }
                    }
                    .frame(width: 38, height: 38)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(color.displayName)
                .accessibilityAddTraits(color == selected ? .isSelected : [])
            }
        }
        .padding(12)
    }
}
