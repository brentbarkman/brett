import { useEffect, useState } from "react";
import { useNow } from "@brett/ui";

/**
 * Date instants and storage-shape dueDate derived from a `useTodayKey`
 * string. Colocated with the hook so every date-driven view (Today, Upcoming,
 * the dock badge) reads bounds from one place and anchors on the user's local
 * day rather than UTC.
 *
 * Returned values:
 *   - `todayStartISO`   instant of local midnight TODAY — for filters like
 *                       `completedAfter` that span from "now in this calendar
 *                       day" forward.
 *   - `endOfWeekISO`    instant of local midnight on the upcoming Sunday —
 *                       for `dueBefore` on the Today view (this-week window).
 *   - `todayDueDateISO` UTC midnight of the user's local calendar date —
 *                       matches the storage convention for `Item.dueDate`
 *                       (every dueDate is UTC midnight of the user's
 *                       intended day). Use when creating a "today" task.
 */
export function todayKeyToBounds(todayKey: string): {
  todayStartISO: string;
  endOfWeekISO: string;
  todayDueDateISO: string;
} {
  const [y, m, d] = todayKey.split("-").map(Number);
  const todayStart = new Date(y, m - 1, d);
  const dow = todayStart.getDay();
  const daysUntilSunday = dow === 0 ? 7 : 7 - dow;
  const endOfWeek = new Date(y, m - 1, d + daysUntilSunday);
  return {
    todayStartISO: todayStart.toISOString(),
    endOfWeekISO: endOfWeek.toISOString(),
    todayDueDateISO: new Date(Date.UTC(y, m - 1, d)).toISOString(),
  };
}

/** Local-day identity in YYYY-MM-DD form, derived from the supplied Date. */
function getLocalDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Returns a string identity that's stable within the user's current LOCAL
 * calendar day and changes when the local day rolls over.
 *
 * Use as a `useMemo`/`useEffect` dep to refresh date-derived values (query
 * bounds, counters, briefing cache keys) so they don't go stale when the
 * desktop app stays open past midnight or wakes from sleep into a new day.
 *
 * Re-checks on window focus and via the visibility-aware `useNow` tick (which
 * auto-resyncs on visibility change, covering the case where the day rolled
 * over while the app was hidden).
 *
 * Why local-day rather than UTC: a previous implementation keyed on UTC day,
 * which silently broke for any non-UTC timezone. UTC midnight does not
 * coincide with the user's local midnight, so the key stayed stable across
 * the user's day rollover. Surfaced as Up Next showing yesterday's meeting
 * after the app stayed open overnight.
 */
export function useTodayKey(): string {
  const now = useNow(60_000);
  const [todayKey, setTodayKey] = useState(() => getLocalDayKey());

  useEffect(() => {
    const next = getLocalDayKey();
    setTodayKey((prev) => (prev === next ? prev : next));
  }, [now]);

  useEffect(() => {
    const check = () => {
      const next = getLocalDayKey();
      setTodayKey((prev) => (prev === next ? prev : next));
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);

  return todayKey;
}
