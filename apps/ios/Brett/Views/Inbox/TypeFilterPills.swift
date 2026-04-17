import SwiftUI

/// Filter option for the Inbox type pills.
///
/// Mirrors the desktop's Inbox filter: "All" | "Tasks" | "Content". Order of
/// the enum cases is the order they render in the UI.
enum FilterType: String, CaseIterable, Identifiable {
    case all
    case tasks
    case content

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .tasks: return "Tasks"
        case .content: return "Content"
        }
    }

    /// Pure filter applied to a fetched list of items.
    /// Exposed as a free function so it can be unit tested without the view.
    static func filter(_ items: [Item], by filter: FilterType) -> [Item] {
        switch filter {
        case .all: return items
        case .tasks: return items.filter { $0.itemType == .task }
        case .content: return items.filter { $0.itemType == .content }
        }
    }
}

/// Horizontal 3-pill filter bar. Selected pill gets a sliding matched-geometry
/// gold background; unselected pills sit on the low-opacity glass track.
struct TypeFilterPills: View {
    @Binding var selected: FilterType

    @Namespace private var pillAnimation

    var body: some View {
        HStack(spacing: 8) {
            ForEach(FilterType.allCases) { option in
                pill(option)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }

    private func pill(_ option: FilterType) -> some View {
        let isSelected = selected == option

        return Button {
            guard selected != option else { return }
            HapticManager.light()
            withAnimation(.spring(response: 0.35, dampingFraction: 0.78)) {
                selected = option
            }
        } label: {
            Text(option.title)
                .font(.system(size: 13, weight: .semibold))
                // Unselected was white/0.40 + medium weight — too low
                // contrast on the dark glass background. /0.70 +
                // semibold makes the pills readable without competing
                // with the selected pill's gold treatment.
                .foregroundStyle(
                    isSelected
                        ? BrettColors.gold
                        : Color.white.opacity(0.70)
                )
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background {
                    Capsule()
                        .fill(
                            isSelected
                                ? BrettColors.gold.opacity(0.20)
                                : Color.white.opacity(0.08)
                        )
                        .overlay {
                            if isSelected {
                                Capsule()
                                    .strokeBorder(
                                        BrettColors.gold.opacity(0.35),
                                        lineWidth: 0.5
                                    )
                                    .matchedGeometryEffect(
                                        id: "pillBorder",
                                        in: pillAnimation
                                    )
                            }
                        }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
