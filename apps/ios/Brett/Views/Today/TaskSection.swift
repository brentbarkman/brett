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
            // `id` exposed for ScrollViewReader so callers can
            // `proxy.scrollTo("section_today")` etc. when content lands
            // here. Lowercased to match the convention TodayPage scrolls to.
            StickyCardSection {
                // Icon dropped — Electron section headers don't have one,
                // and the user wants iOS to match. The label text +
                // (optional) accentColor stripe on the rows already
                // signal what kind of section this is.
                HStack(spacing: 6) {
                    Text(label.uppercased())
                        .font(BrettTypography.sectionLabel)
                        .tracking(2.4)
                        // Always neutral white — matches Electron's
                        // `text-white/40` for ALL sections (Overdue
                        // included). Per-section accent now lives only
                        // on the row stripe.
                        .foregroundStyle(Color.white.opacity(0.60))

                    Spacer()

                    Text("\(items.count)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.40))
                }
            } content: {
                VStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        Group {
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
                        // Per-row transition: rows fade + slide in from
                        // the top on insert, fade + slightly collapse on
                        // removal. Completing a task now visibly slides
                        // it out of this section instead of popping.
                        .transition(
                            .asymmetric(
                                insertion: .opacity.combined(with: .move(edge: .top)),
                                removal: .opacity.combined(with: .scale(scale: 0.92))
                            )
                        )
                    }
                }
                .padding(.bottom, 8)
                // Drives the row enter/exit animations above. Keyed on
                // the id list so only insertions/removals animate, not
                // every property mutation inside an item.
                .animation(
                    .spring(response: 0.45, dampingFraction: 0.85),
                    value: items.map(\.id)
                )
            }
            .id("section_\(label.lowercased().replacingOccurrences(of: " ", with: "_"))")
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
