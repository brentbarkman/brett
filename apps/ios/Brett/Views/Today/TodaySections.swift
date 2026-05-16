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
    let thisWeekend: [Item]
    let nextWeek: [Item]
    let doneToday: [Item]

    var activeCount: Int {
        overdue.count + today.count + thisWeek.count + thisWeekend.count + nextWeek.count
    }

    var hasDoneToday: Bool { !doneToday.isEmpty }

    var isEveryActiveSectionEmpty: Bool { activeCount == 0 }

    /// Count shown on the iOS home-screen badge and the macOS dock badge.
    ///
    /// Inclusion rules (must stay in lockstep with desktop's `App.tsx`
    /// `badgeCount`):
    ///   - Always: overdue + today + thisWeek
    ///   - On Sat/Sun: + thisWeekend (the weekend has arrived)
    ///
    /// Weekend items deliberately stay out of the badge on weekdays —
    /// a Saturday task shouldn't nag the user on Tuesday — but roll in
    /// once the weekend itself arrives.
    static func badgeCount(
        items: [Item],
        now: Date = Date(),
        localCalendar: Calendar = .current
    ) -> Int {
        let s = bucket(items: items, reflowKey: 0, now: now, localCalendar: localCalendar)
        // "Weekend now" is decided from the user's LOCAL day-of-week, not
        // UTC's. Friday 9:43 PM MT is still Friday for the badge.
        let weekday = localCalendar.component(.weekday, from: now) // Sun=1..Sat=7
        let isWeekend = weekday == 1 || weekday == 7
        return s.overdue.count
            + s.today.count
            + s.thisWeek.count
            + (isWeekend ? s.thisWeekend.count : 0)
    }

    /// UTC calendar — used for reading calendar-date components of stored
    /// `dueDate` values (which are encoded as UTC midnight of the user's
    /// intended local calendar date). The "today" anchor is derived from
    /// the user's local calendar, not from this one — mixing the two was
    /// the source of the Friday-evening-MT bug.
    static let utcCalendar: Calendar = {
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
        pendingDoneIDs: Set<String> = [],
        now: Date = Date(),
        localCalendar: Calendar = .current
    ) -> TodaySections {
        _ = reflowKey // force re-derivation on change; see toggle() in the parent

        // "Today" = UTC midnight of the user's LOCAL calendar date. The
        // old code used the UTC calendar's startOfDay for everything,
        // which on Friday 9:43 PM MDT (= Sat 3:43 AM UTC) thought today
        // was Saturday — collapsing weekend tasks into Today.
        let startOfToday = DateHelpers.utcMidnightOfLocalDate(now, in: localCalendar)
        let startOfTomorrow = DateHelpers.utcCalendar.date(byAdding: .day, value: 1, to: startOfToday)
            ?? startOfToday.addingTimeInterval(86_400)

        // Boundary offsets mirror desktop's TS `urgencyBucketRanges` in
        // `packages/business/src/index.ts` EXACTLY — change one, change
        // the other. Day-of-week comes from the LOCAL today anchor.
        let weekday = DateHelpers.utcCalendar.component(.weekday, from: startOfToday) // Sun=1..Sat=7
        let dow = weekday - 1 // 0=Sun..6=Sat (matches TS getUTCDay())

        struct Ranges { let thisWeekStart, thisWeekEnd, thisWeekendStart, thisWeekendEnd, nextWeekEnd: Int }
        let r: Ranges = {
            if dow == 0 {
                return Ranges(thisWeekStart: 1, thisWeekEnd: 5, thisWeekendStart: 6, thisWeekendEnd: 7, nextWeekEnd: 14)
            }
            if dow == 6 {
                return Ranges(thisWeekStart: 2, thisWeekEnd: 6, thisWeekendStart: 1, thisWeekendEnd: 1, nextWeekEnd: 8)
            }
            return Ranges(
                thisWeekStart: 1,
                thisWeekEnd: 5 - dow,
                thisWeekendStart: 6 - dow,
                thisWeekendEnd: 7 - dow,
                nextWeekEnd: 14 - dow
            )
        }()

        var overdue: [Item] = []
        var today: [Item] = []
        var thisWeek: [Item] = []
        var thisWeekend: [Item] = []
        var nextWeek: [Item] = []
        var doneToday: [Item] = []

        for item in items {
            if item.itemStatus == .archived { continue }

            let effectiveStatus: ItemStatus = pendingDoneIDs.contains(item.id) ? .active : item.itemStatus

            if effectiveStatus == .done {
                if let completed = item.completedAt,
                   completed >= startOfToday && completed < startOfTomorrow {
                    doneToday.append(item)
                }
                continue
            }

            if effectiveStatus != .active { continue }
            guard let due = item.dueDate else { continue }

            if due < startOfToday {
                overdue.append(item)
                continue
            }

            let diff = DateHelpers.utcCalendar.dateComponents([.day], from: startOfToday, to: due).day ?? 0
            if diff == 0 {
                today.append(item)
                continue
            }
            let dueWeekday = DateHelpers.utcCalendar.component(.weekday, from: due)
            let isWeekendDay = dueWeekday == 1 || dueWeekday == 7

            if isWeekendDay && diff >= r.thisWeekendStart && diff <= r.thisWeekendEnd {
                thisWeekend.append(item)
            } else if !isWeekendDay && diff >= r.thisWeekStart && diff <= r.thisWeekEnd {
                thisWeek.append(item)
            } else if diff <= r.nextWeekEnd {
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
            thisWeekend: thisWeekend.sorted(by: activeSort),
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
