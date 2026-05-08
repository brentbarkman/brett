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
import { useTodayKey } from "../useTodayKey";

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
