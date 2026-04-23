import Foundation

/// Bucketing logic for the Today page.
///
/// Pure value type — no SwiftUI, no SwiftData-context dependency beyond the
/// `Item` rows you hand it. Kept separate from `TodayPage.swift` so the
/// rules can be unit-tested without spinning up a view hierarchy, and so
/// the 590-line view file stays focused on layout + state.
///
/// Adding a section (e.g. "Someday") is a two-place change: declare the
/// bucket here, surface it in `TodayPage.taskSections`.
struct TodaySections {
    let overdue: [Item]
    let today: [Item]
    let thisWeek: [Item]
    let nextWeek: [Item]
    let doneToday: [Item]

    var activeCount: Int {
        overdue.count + today.count + thisWeek.count + nextWeek.count
    }

    var hasDoneToday: Bool { !doneToday.isEmpty }

    var isEveryActiveSectionEmpty: Bool { activeCount == 0 }

    /// Bucket items into Overdue / Today / This Week / Next Week / Done Today
    /// based on local-calendar date math.
    ///
    /// - Parameters:
    ///   - items: the full set of live Items to bucket. Archived rows are
    ///     dropped before any section placement.
    ///   - reflowKey: unused by the logic itself but participates in the
    ///     computed identity so SwiftUI re-derives the sections when the
    ///     parent bumps it (drives the debounced completion cascade so a
    ///     just-ticked row doesn't immediately re-flow and steal the next
    ///     tap target).
    ///   - pendingDoneIDs: IDs the user just marked done. These rows stay
    ///     in their original active section until the debounce expires
    ///     so rapid sequential taps don't miss their target.
    static func bucket(
        items: [Item],
        reflowKey: Int,
        pendingDoneIDs: Set<String> = []
    ) -> TodaySections {
        _ = reflowKey // force re-derivation on change; see toggle() in the parent
        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let endOfToday = calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? startOfToday.addingTimeInterval(86_400)

        // End of this week = next Sunday midnight local time.
        let weekday = calendar.component(.weekday, from: now)
        let daysUntilEndOfWeek = max(0, 8 - weekday) // Sunday = 1, Saturday = 7
        let endOfThisWeek = calendar.date(byAdding: .day, value: daysUntilEndOfWeek, to: startOfToday) ?? endOfToday
        let endOfNextWeek = calendar.date(byAdding: .day, value: 7, to: endOfThisWeek) ?? endOfThisWeek.addingTimeInterval(7 * 86_400)

        var overdue: [Item] = []
        var today: [Item] = []
        var thisWeek: [Item] = []
        var nextWeek: [Item] = []
        var doneToday: [Item] = []

        for item in items {
            if item.itemStatus == .archived { continue }

            // If this item is being held in its previous section, override
            // its effective status. The TaskRow still reads `isCompleted`
            // from the live model so the checkbox + strikethrough still
            // show as done — only the section assignment is delayed.
            let effectiveStatus: ItemStatus = pendingDoneIDs.contains(item.id) ? .active : item.itemStatus

            if effectiveStatus == .done {
                if let completed = item.completedAt,
                   completed >= startOfToday && completed < endOfToday {
                    doneToday.append(item)
                }
                continue
            }

            // Active tasks only from here on out.
            if effectiveStatus != .active { continue }
            guard let due = item.dueDate else { continue }

            if due < startOfToday {
                overdue.append(item)
            } else if due < endOfToday {
                today.append(item)
            } else if due < endOfThisWeek {
                thisWeek.append(item)
            } else if due < endOfNextWeek {
                nextWeek.append(item)
            }
        }

        return TodaySections(
            overdue: overdue.sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) },
            today: today.sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) },
            thisWeek: thisWeek.sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) },
            nextWeek: nextWeek.sorted { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) },
            doneToday: doneToday.sorted {
                ($0.completedAt ?? .distantPast) > ($1.completedAt ?? .distantPast)
            }
        )
    }
}
