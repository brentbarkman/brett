/**
 * Regression test for stale calendar-anchor dates across midnight / sleep-wake.
 *
 * History: `CalendarPage.currentDate` and `App.sidebarDate` were seeded once
 * via `useState(new Date())` and never advanced when the UTC day rolled over
 * or the machine woke from sleep into a new day. Users who left the Electron
 * app open overnight would come back to a calendar still anchored to the
 * previous day. `usePinnedDate` encapsulates the anchor with a "pinned to
 * today" flag that snaps forward on day rollover unless the user has
 * deliberately navigated to a different day.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePinnedDate } from "../usePinnedDate";

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

describe("usePinnedDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("snaps the anchor forward on UTC day rollover while pinned to today", () => {
    vi.setSystemTime(new Date("2026-04-18T23:59:00Z"));
    const { result } = renderHook(() => usePinnedDate());
    const [initialDate] = result.current;
    expect(sameLocalDay(initialDate, new Date("2026-04-18T23:59:00Z"))).toBe(true);

    act(() => {
      vi.setSystemTime(new Date("2026-04-19T00:01:00Z"));
      vi.advanceTimersByTime(60_000);
    });

    const [updatedDate] = result.current;
    expect(sameLocalDay(updatedDate, new Date("2026-04-19T00:01:00Z"))).toBe(true);
  });

  it("does NOT snap forward when the user has navigated to a non-today date", () => {
    vi.setSystemTime(new Date("2026-04-18T10:00:00Z"));
    const { result } = renderHook(() => usePinnedDate());

    const april10 = new Date("2026-04-10T12:00:00Z");
    act(() => {
      result.current[1](april10);
    });

    act(() => {
      vi.setSystemTime(new Date("2026-04-19T00:01:00Z"));
      vi.advanceTimersByTime(60_000);
    });

    const [date] = result.current;
    expect(sameLocalDay(date, april10)).toBe(true);
  });

  it("re-pins and snaps forward after the user calls setDate(new Date())", () => {
    vi.setSystemTime(new Date("2026-04-18T10:00:00Z"));
    const { result } = renderHook(() => usePinnedDate());

    act(() => {
      result.current[1](new Date("2026-04-10T12:00:00Z"));
    });

    act(() => {
      result.current[1](new Date("2026-04-18T10:00:00Z"));
    });

    act(() => {
      vi.setSystemTime(new Date("2026-04-19T00:01:00Z"));
      vi.advanceTimersByTime(60_000);
    });

    const [date] = result.current;
    expect(sameLocalDay(date, new Date("2026-04-19T00:01:00Z"))).toBe(true);
  });
});
