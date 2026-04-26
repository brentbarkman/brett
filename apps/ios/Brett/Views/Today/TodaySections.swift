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

    /// Count shown on the iOS home-screen badge and the macOS dock badge.
    /// Overdue + due today + due this week, excluding Next Week, completed,
    /// archived, and items without a due date. Semantically equivalent to
    /// desktop's `activeThingsForCount.length` in `apps/desktop/src/App.tsx`,
    /// but the two can diverge at week boundaries for non-UTC timezones —
    /// desktop uses UTC end-of-week (`getEndOfWeekUTC`) while iOS uses
    /// `Calendar.current` (local time). Matches the existing iOS vs desktop
    /// split in the Today view itself, so the badge stays consistent with
    /// what each client shows on-screen.
    static func badgeCount(items: [Item]) -> Int {
        let s = bucket(items: items, reflowKey: 0)
        return s.overdue.count + s.today.count + s.thisWeek.count
    }

    /// UTC calendar — matches desktop's `getTodayUTC` / `getEndOfWeekUTC`
    /// (`packages/business/src/index.ts`). Both clients now bucket on
    /// the same UTC day boundaries so a row in "Today" on iOS is in
    /// "Today" on desktop, regardless of where the user is. Trade-off:
    /// users west of UTC see "today" roll over before local midnight;
    /// users east see it roll over after. Acceptable cost for cross-
    /// platform consistency, which is what the user explicitly asked for.
    private static let utcCalendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    /// Bucket items into Overdue / Today / This Week / Next Week / Done Today
    /// based on UTC-calendar date math (matches desktop).
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
        let calendar = Self.utcCalendar
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let endOfToday = calendar.date(byAdding: .day, value: 1, to: startOfToday) ?? startOfToday.addingTimeInterval(86_400)

        // End of this week = next Sunday midnight UTC. Mirrors
        // `getEndOfWeekUTC` in packages/business: "if today is Sunday,
        // next Sunday; otherwise the upcoming Sunday."
        let weekday = calendar.component(.weekday, from: now)
        let daysUntilEndOfWeek = weekday == 1 ? 7 : (8 - weekday) // Sunday = 1
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

        // Sort within each bucket by `createdAt DESC` to match desktop
        // (`apps/api/src/routes/things.ts:191` — `orderBy: [{ createdAt: "desc" }]`,
        // never re-sorted client-side). Was previously `dueDate ASC`,
        // which produced visibly different ordering vs desktop on the
        // exact same task set. Stable secondary sort by `id` so ties
        // don't flicker between renders.
        let activeSort: (Item, Item) -> Bool = {
            if $0.createdAt != $1.createdAt {
                return $0.createdAt > $1.createdAt
            }
            return $0.id < $1.id
        }
        return TodaySections(
            overdue: overdue.sorted(by: activeSort),
            today: today.sorted(by: activeSort),
            thisWeek: thisWeek.sorted(by: activeSort),
            nextWeek: nextWeek.sorted(by: activeSort),
            doneToday: doneToday.sorted {
                if let a = $0.completedAt, let b = $1.completedAt, a != b {
                    return a > b
                }
                return $0.id < $1.id
            }
        )
    }
}

/// Memo-cache around `TodaySections.bucket(...)`. Held in a `@State`
/// reference type on `TodayPage` so it survives across body passes.
///
/// Why: `TodayPage.sections` was a computed property calling
/// `TodaySections.bucket(items:reflowKey:pendingDoneIDs:)` on every
/// SwiftUI body re-evaluation, which fires on EVERY @Query update,
/// every @State change (completionPulse, scenePhase, etc.), and every
/// TabView selection. Bucket is O(n) classify + 5 small sorts; for
/// 200 active items + 50 done that's a few hundred operations per
/// render, including comparing dates. Adds up under a sync climb.
///
/// The cache is keyed by a hash of (id, status, dueDate, completedAt)
/// across the items plus the reflow + pending-done state. Hash is
/// also O(n), but ~10x cheaper than bucket because there's no sort.
/// On cache hits (items stable, state changes only) we skip bucket
/// entirely.
///
/// `@MainActor` because `TodayPage` is main-actor; the cache itself
/// has no other reason to leave it.
@MainActor
final class TodaySectionsCache {
    private var lastSignature: Int?
    private var lastResult: TodaySections?

    func sections(
        items: [Item],
        reflowKey: Int,
        pendingDoneIDs: Set<String>
    ) -> TodaySections {
        let signature = Self.signature(
            items: items,
            reflowKey: reflowKey,
            pendingDoneIDs: pendingDoneIDs
        )
        if let lastSignature, lastSignature == signature, let lastResult {
            return lastResult
        }
        let result = TodaySections.bucket(
            items: items,
            reflowKey: reflowKey,
            pendingDoneIDs: pendingDoneIDs
        )
        lastSignature = signature
        lastResult = result
        return result
    }

    /// Hash the inputs that could change the bucket output. Mirrors
    /// the fields `bucket()` reads. Including pendingDoneIDs and
    /// reflowKey so the debounce mechanic still re-derives correctly.
    /// `Hasher.finalize()` collisions are vanishingly rare in this
    /// shape — even if one happens, the only consequence is one
    /// stale render before the next mutation re-keys it.
    private static func signature(
        items: [Item],
        reflowKey: Int,
        pendingDoneIDs: Set<String>
    ) -> Int {
        var hasher = Hasher()
        hasher.combine(reflowKey)
        // Set is hashable but its `hashValue` is unstable across
        // launches; combine sorted elements for a deterministic hash
        // within the process lifetime (we only need stability across
        // back-to-back render passes, not across launches).
        for id in pendingDoneIDs.sorted() {
            hasher.combine(id)
        }
        for item in items {
            hasher.combine(item.id)
            hasher.combine(item.status)
            hasher.combine(item.dueDate)
            hasher.combine(item.completedAt)
        }
        return hasher.finalize()
    }
}
