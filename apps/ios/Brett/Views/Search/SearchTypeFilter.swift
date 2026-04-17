import SwiftUI

/// Horizontal chip row for filtering search results by entity type.
///
/// Empty `selection` means "All" — the first chip renders selected to match.
/// Tapping a chip toggles its type in/out of the selection set. Tapping
/// "All" clears the selection. Selection lives on the parent (the sheet),
/// so this view is pure chrome.
struct SearchTypeFilter: View {
    @Binding var selection: Set<SearchEntityType>

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(label: "All", isSelected: selection.isEmpty) {
                    selection.removeAll()
                }

                ForEach(SearchEntityType.allCases, id: \.self) { type in
                    chip(
                        label: type.label,
                        icon: type.iconName,
                        isSelected: selection.contains(type)
                    ) {
                        toggle(type)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
    }

    // MARK: - Chip

    private func chip(
        label: String,
        icon: String? = nil,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 11, weight: .semibold))
                }
                Text(label)
                    .font(.system(size: 13, weight: .medium))
            }
            .foregroundStyle(
                isSelected ? BrettColors.textHeading : BrettColors.textSecondary
            )
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
                Capsule()
                    .fill(isSelected ? BrettColors.gold.opacity(0.20) : Color.white.opacity(0.06))
            )
            .overlay(
                Capsule()
                    .stroke(
                        isSelected ? BrettColors.gold.opacity(0.50) : BrettColors.cardBorder,
                        lineWidth: 0.5
                    )
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Helpers

    private func toggle(_ type: SearchEntityType) {
        if selection.contains(type) {
            selection.remove(type)
        } else {
            selection.insert(type)
        }
    }
}
