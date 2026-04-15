/**
 * Regression test for stale date-boundary staleness across midnight.
 *
 * History: `TodayView` and several App.tsx consumers captured today's date
 * boundaries via `useState(() => getTodayUTC())` at mount time, freezing
 * them for the component's lifetime. If the desktop app stayed open past
 * midnight UTC, newly-created tasks with `dueDate = today` wouldn't match
 * the frozen `dueBefore` bound and disappeared from the Today view until
 * the user reloaded. This was first surfaced when a "Re-link AI Provider"
 * task didn't appear in any list.
 *
 * `useTodayKey` returns a string identity that changes when the UTC day
 * rolls over, intended as a useMemo dep so derived boundaries re-evaluate.
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

  it("returns a stable key within the same UTC day", () => {
    vi.setSystemTime(new Date("2026-04-15T10:00:00Z"));
    const { result } = renderHook(() => useTodayKey());
    const initial = result.current;

    // Advance 10 hours — same UTC day (10:00 → 20:00 on April 15)
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 60 * 1000);
    });

    expect(result.current).toBe(initial);
  });

  it("changes key when UTC day rolls over while app stays open", () => {
    vi.setSystemTime(new Date("2026-04-15T23:59:00Z"));
    const { result } = renderHook(() => useTodayKey());
    const dayBefore = result.current;

    // Cross UTC midnight; the interval check should pick up the change
    act(() => {
      vi.setSystemTime(new Date("2026-04-16T00:01:00Z"));
      vi.advanceTimersByTime(60_000); // the interval runs once a minute
    });

    expect(result.current).not.toBe(dayBefore);
    expect(result.current).toContain("2026-04-16");
  });
});
