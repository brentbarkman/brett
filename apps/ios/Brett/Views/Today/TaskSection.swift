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
    var onSchedule: ((String, Date?, DueDatePrecision, Bool) -> Void)? = nil
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
                // Header treatment per v18 mockup `.section-head`:
                //   color: rgba(255,255,255,0.55)
                //   font: 11px, weight 600, uppercase, ls 0.06em
                // Overdue and Done sections take their own tints
                // (`.overdue` muted-red family, `.done-head` muted
                // white + gold count). `Section.kind(label:)` reads
                // the label string and returns the right palette.
                let kind = SectionKind.kind(for: label)
                HStack(spacing: 6) {
                    // Label gets a layered legibility shadow because Today
                    // now floats its task sections directly over the
                    // photo at rest — without this, OVERDUE / TODAY etc
                    // wash out against bright sky/horizon regions of the
                    // wallpaper. Same recipe as `HeroLegibilityShadow`
                    // in `TodayHero`. Once the user scrolls past the
                    // hero, `MainContainer.fullScreenWashOpacity` fades
                    // the wash in over the photo and the shadow becomes
                    // a no-op visually.
                    Text(label.uppercased())
                        .font(.system(size: 13, weight: .semibold))
                        .tracking(0.78) // 0.06em at 13pt
                        .foregroundStyle(kind.labelColor)
                        .shadow(color: Color.black.opacity(0.40), radius: 1, x: 0, y: 0)
                        .shadow(color: Color.black.opacity(0.30), radius: 8, x: 0, y: 2)

                    Spacer()

                    // Count pill carries its own bg fill so the text
                    // inside has contrast regardless of what's behind
                    // the row — no extra shadow needed there.
                    Text("\(items.count)")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(kind.countTextColor)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 3)
                        .background {
                            Capsule().fill(kind.countBgColor)
                        }
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
                                // Hairline between rows. Mockup
                                // `.task { border-bottom: 1px solid
                                // rgba(255,255,255,0.06) }`. Indented
                                // 14pt to match the row's leading
                                // padding so the line starts under
                                // the icon's left edge, not under
                                // the card border.
                                Rectangle()
                                    .fill(Color.white.opacity(0.06))
                                    .frame(height: 0.5)
                                    .padding(.horizontal, 14)
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

    /// Palette mapping for section header chrome. Each kind drives
    /// label color + count pill bg + count text color, matching the
    /// v18 mockup's `.section-head`, `.section-head.overdue`, and
    /// `.section-head.done-head` rules verbatim.
    private enum SectionKind {
        case standard
        case overdue
        case done

        static func kind(for label: String) -> SectionKind {
            switch label.lowercased() {
            case "overdue": return .overdue
            case "done today": return .done
            default: return .standard
            }
        }

        var labelColor: Color {
            switch self {
            case .standard: return Color.white.opacity(0.55)
            case .overdue: return BrettColors.overdueRed
            case .done: return Color.white.opacity(0.40)
            }
        }
        var countBgColor: Color {
            switch self {
            case .standard: return Color.white.opacity(0.10)
            case .overdue: return BrettColors.overdueRed.opacity(0.20)
            case .done: return BrettColors.gold.opacity(0.20)
            }
        }
        var countTextColor: Color {
            switch self {
            case .standard: return Color.white.opacity(0.65)
            case .overdue: return BrettColors.overdueRed
            case .done: return Color(red: 1.0, green: 0.86, blue: 0.71).opacity(0.85)
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
            onSchedule: { dueDate, precision, tonight in onSchedule?(item.id, dueDate, precision, tonight) },
            onArchive: { onArchive?(item.id) },
            onDelete: { onDelete?(item.id) },
            onReorder: { newOrder in onReorder?(newOrder) }
        )
    }
}
