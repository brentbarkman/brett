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
    // Swipe handlers — default no-ops so existing callers keep working.
    // Today page wires these to ItemStore so swipe-to-schedule/archive/delete
    // actually persist through the sync engine.
    var onSchedule: ((String, Date?) -> Void)? = nil
    var onArchive: ((String) -> Void)? = nil
    var onDelete: ((String) -> Void)? = nil
    // Drag-to-reorder inputs. When absent, drag is disabled on rows in this
    // section (common for mixed-source sections like "This Week").
    var reorderIDs: [String] = []
    var onReorder: (([String]) -> Void)? = nil

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

                                taskRow(for: item)
                                    .padding(.leading, 8)
                            }
                        } else {
                            taskRow(for: item)
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

    /// Builds a TaskRow wired to this section's handlers. Drag-to-reorder is
    /// only enabled when the caller supplied both `reorderIDs` and
    /// `onReorder` — keeps the gesture off for cross-bucket sections where
    /// a reorder doesn't have a clear target.
    private func taskRow(for item: Item) -> some View {
        TaskRow(
            item: item,
            listName: listNameProvider(item),
            allowDrag: onReorder != nil && !reorderIDs.isEmpty,
            dragIDs: reorderIDs,
            onToggle: { onToggle(item.id) },
            onSelect: { onSelect?(item.id) },
            onSchedule: { dueDate in onSchedule?(item.id, dueDate) },
            onArchive: { onArchive?(item.id) },
            onDelete: { onDelete?(item.id) },
            onReorder: { newOrder in onReorder?(newOrder) }
        )
    }
}
