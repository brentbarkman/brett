/**
 * Regression test for the "Up Next stuck on a past event" bug.
 *
 * History: the desktop App.tsx selected `nextUpEvent` via an IIFE inside
 * its render and passed the single event to `useNextUpTimer`. The timer
 * hook re-rendered on its own 10s tick, but only the card subtree saw
 * those re-renders — the parent's IIFE selection was frozen until some
 * unrelated state change re-rendered App. So when the current meeting's
 * end time passed, the card showed "Ended" forever instead of advancing
 * to the next meeting.
 *
 * Fix: `useNextUpTimer` accepts the events list and owns selection,
 * recomputing both "which event is current" and "how long until it ends"
 * on the same visibility-aware tick.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { CalendarEventDisplay } from "@brett/types";
import { useNextUpTimer } from "../useNextUpTimer";

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function makeEvent(
  id: string,
  startTime: string,
  endTime: string,
): CalendarEventDisplay {
  return {
    id,
    title: id,
    startTime,
    endTime,
    isAllDay: false,
    location: null,
    description: null,
    meetingLink: null,
    attendees: [],
  } as unknown as CalendarEventDisplay;
}

describe("useNextUpTimer event selection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("returns null event and null timer when the list is empty", () => {
    const { result } = renderHook(() => useNextUpTimer([]));
    expect(result.current.event).toBeNull();
    expect(result.current.timer).toBeNull();
  });

  it("selects the currently-happening event", () => {
    vi.setSystemTime(new Date("2026-05-06T10:30:00"));
    const events = [
      makeEvent("A", "08:00", "09:00"),
      makeEvent("B", "10:00", "11:00"),
      makeEvent("C", "14:00", "15:00"),
    ];
    const { result } = renderHook(() => useNextUpTimer(events));
    expect(result.current.event?.id).toBe("B");
    expect(result.current.timer?.isHappening).toBe(true);
  });

  it("selects the upcoming event when nothing is currently happening", () => {
    vi.setSystemTime(new Date("2026-05-06T09:30:00"));
    const events = [
      makeEvent("A", "08:00", "09:00"),
      makeEvent("B", "10:00", "11:00"),
      makeEvent("C", "14:00", "15:00"),
    ];
    const { result } = renderHook(() => useNextUpTimer(events));
    expect(result.current.event?.id).toBe("B");
    expect(result.current.timer?.isHappening).toBe(false);
    expect(result.current.timer?.minutesAway).toBe(30);
  });

  it("rolls to the next event after the current one ends, without parent re-render", () => {
    vi.setSystemTime(new Date("2026-05-06T10:30:00"));
    const events = [
      makeEvent("A", "08:00", "09:00"),
      makeEvent("B", "10:00", "11:00"),
      makeEvent("C", "14:00", "15:00"),
    ];
    const { result } = renderHook(() => useNextUpTimer(events));
    expect(result.current.event?.id).toBe("B");

    // Advance past B's end. Critical: no rerender() — the hook must
    // reselect on its own tick.
    act(() => {
      vi.setSystemTime(new Date("2026-05-06T11:01:00"));
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.event?.id).toBe("C");
    expect(result.current.timer?.isExpired).toBe(false);
  });

  it("returns null when every event in the list has ended", () => {
    vi.setSystemTime(new Date("2026-05-06T16:00:00"));
    const events = [
      makeEvent("A", "08:00", "09:00"),
      makeEvent("B", "10:00", "11:00"),
    ];
    const { result } = renderHook(() => useNextUpTimer(events));
    expect(result.current.event).toBeNull();
    expect(result.current.timer).toBeNull();
  });

  it("does not select an event from a previous day even if its HH:MM is later than now", () => {
    // Regression for "Up Next showing a thing from yesterday" after the
    // desktop app stayed open across midnight. If the events list ever
    // contains a previous-day event (e.g. because the calendar query
    // bounds went stale on local-day rollover), the selection logic must
    // not pick it just because its end-of-day HH:MM is greater than the
    // current HH:MM.
    vi.setSystemTime(new Date("2026-05-07T09:00:00"));
    const events = [
      makeEvent(
        "yesterdays-3pm",
        "2026-05-06T15:00:00",
        "2026-05-06T16:00:00",
      ),
    ];
    const { result } = renderHook(() => useNextUpTimer(events));
    expect(result.current.event).toBeNull();
    expect(result.current.timer).toBeNull();
  });
});
