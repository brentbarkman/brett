/**
 * Regression test for stale date-boundary staleness across midnight.
 *
 * History: `TodayView` and several App.tsx consumers captured today's date
 * boundaries via `useState(() => getTodayUTC())` at mount time, freezing
 * them for the component's lifetime. If the desktop app stayed open past
 * midnight, newly-created tasks with `dueDate = today` wouldn't match the
 * frozen `dueBefore` bound and disappeared from the Today view until the
 * user reloaded.
 *
 * Earlier fix used a UTC-day key, which silently broke for any non-UTC
 * timezone: local midnight does not coincide with UTC midnight, so the key
 * stayed stable across local-day rollover. Surfaced as Up Next showing a
 * meeting from yesterday after the app stayed open overnight.
 *
 * `useTodayKey` now returns a string that changes when the user's LOCAL
 * day rolls over, intended as a useMemo dep so derived boundaries (calendar
 * range, due bounds) re-evaluate.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTodayKey, todayKeyToBounds } from "../useTodayKey";

describe("useTodayKey", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a stable key within the same local day", () => {
    vi.setSystemTime(new Date("2026-04-15T10:00:00"));
    const { result } = renderHook(() => useTodayKey());
    const initial = result.current;

    // Advance several hours — still the same local day
    act(() => {
      vi.advanceTimersByTime(8 * 60 * 60 * 1000);
    });

    expect(result.current).toBe(initial);
  });

  it("changes key when the local day rolls over while app stays open", () => {
    vi.setSystemTime(new Date("2026-04-15T23:59:00"));
    const { result } = renderHook(() => useTodayKey());
    const dayBefore = result.current;

    // Cross local midnight; the 60s interval check picks up the change
    act(() => {
      vi.setSystemTime(new Date("2026-04-16T00:01:00"));
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current).not.toBe(dayBefore);
    expect(result.current).toContain("2026-04-16");
  });

  it("changes key on local midnight even when UTC day has not rolled over", () => {
    // Regression for the specific "Up Next stuck on yesterday's meeting"
    // bug. Chosen instants:
    //   - 2026-05-06T23:59 local (whatever local TZ tests run in) — the
    //     wall-clock hasn't crossed local midnight.
    //   - 2026-05-07T00:01 local — local day has rolled, but the UTC day
    //     may not have rolled (depending on TZ offset).
    // The previous UTC-keyed implementation failed here for any TZ with a
    // negative offset (e.g. America/New_York), because UTC midnight had
    // already passed hours earlier and the key wouldn't change again until
    // the *next* UTC midnight.
    vi.setSystemTime(new Date("2026-05-06T23:59:00"));
    const { result } = renderHook(() => useTodayKey());
    const dayBefore = result.current;

    act(() => {
      vi.setSystemTime(new Date("2026-05-07T00:01:00"));
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current).not.toBe(dayBefore);
    expect(result.current).toContain("2026-05-07");
  });
});

/**
 * Regression tests for issue #197 — Today view showed tomorrow tasks as
 * today at 6:31pm MT. Pre-fix, the view derived its `dueBefore` /
 * `completedAfter` / new-task `dueDate` from `getTodayUTC()` / `getEndOfWeekUTC()`,
 * which anchor on the server-process UTC day. Replacing the anchor with
 * `todayKeyToBounds` (local-key-derived) is the desktop side of the fix.
 */
describe("todayKeyToBounds", () => {
  it("encodes the user's local calendar day as UTC midnight for storage", () => {
    // Storage convention: dueDate is UTC midnight of the user's intended
    // calendar date, regardless of the runtime timezone.
    expect(todayKeyToBounds("2026-05-31").todayDueDateISO).toBe(
      "2026-05-31T00:00:00.000Z",
    );
    expect(todayKeyToBounds("2026-01-01").todayDueDateISO).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("todayStartISO round-trips back to the same local calendar date", () => {
    // `new Date(todayStartISO)` parsed back as local time must agree with
    // the parts we constructed it from. Catches a stale "UTC midnight"
    // anchor that would shift the calendar day for non-UTC runtimes.
    const r = todayKeyToBounds("2026-05-31");
    const d = new Date(r.todayStartISO);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May (0-indexed)
    expect(d.getDate()).toBe(31);
  });

  it("endOfWeekISO lands on the upcoming local Sunday for every weekday", () => {
    // Walk a full week and assert the endOfWeek always reads as Sunday in
    // local time. Independent of the runtime timezone — the helper computes
    // the day-of-week locally, so the resulting Date's local getDay() === 0.
    const days = [
      "2026-05-25", // Mon
      "2026-05-26", // Tue
      "2026-05-27", // Wed
      "2026-05-28", // Thu
      "2026-05-29", // Fri
      "2026-05-30", // Sat
      "2026-05-31", // Sun
    ];
    for (const key of days) {
      const dow = new Date(todayKeyToBounds(key).endOfWeekISO).getDay();
      expect(dow).toBe(0);
    }
  });

  it("Sunday's endOfWeek is the next Sunday (a full week out, not today)", () => {
    // Without `dow === 0 ? 7 : 7 - dow`, Sunday would resolve to "0 days
    // out" — i.e. dueBefore == today, hiding everything later in the week.
    const r = todayKeyToBounds("2026-05-31"); // Sun
    expect(r.endOfWeekISO).not.toBe(r.todayStartISO);
    // Both anchors are local midnights, so the difference resolves to a
    // multiple of 24h (modulo DST, which doesn't apply between May 31 and
    // Jun 7). 7 days is the expected gap.
    const startDate = new Date(r.todayStartISO);
    const endDate = new Date(r.endOfWeekISO);
    const days = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
    expect(days).toBe(7);
  });
});
