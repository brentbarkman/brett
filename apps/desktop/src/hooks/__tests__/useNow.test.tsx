/**
 * useNow / useVisibilityAwareInterval — visibility-aware tick primitives.
 *
 * History: the desktop app had five separate `setInterval(..., 60000)` sites
 * (weather clock, two calendar current-time lines, useTodayKey, two
 * useBackground checks) that all ticked unconditionally even when the app
 * was open in the background. macOS doesn't consider the window "hidden"
 * just because another app has focus, so Chromium's default timer
 * throttling didn't apply, and each tick woke the renderer. These hooks
 * are the consolidated replacement; both must pause while hidden and
 * resume cleanly on visibilitychange.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNow, useVisibilityAwareInterval } from "../useNow";

/**
 * Flip the document's visibilityState and fire the change event. Wrap in
 * the caller's `act()` block — the visibility handler triggers React state
 * updates synchronously (useNow re-syncs `now` on becoming visible), so
 * unwrapped dispatches produce act() warnings.
 */
function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("ticks at the configured cadence while visible", () => {
    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    const { result } = renderHook(() => useNow(60_000));
    const initial = result.current.toISOString();

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(result.current.toISOString()).not.toBe(initial);
  });

  it("does NOT tick while document is hidden", () => {
    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    const { result } = renderHook(() => useNow(60_000));
    const initial = result.current.toISOString();

    act(() => { setVisibility("hidden"); });
    act(() => { vi.advanceTimersByTime(30 * 60_000); });
    expect(result.current.toISOString()).toBe(initial);
  });

  it("re-syncs immediately when becoming visible again", () => {
    vi.setSystemTime(new Date("2026-04-26T10:00:00Z"));
    const { result } = renderHook(() => useNow(60_000));
    const initial = result.current.toISOString();

    act(() => { setVisibility("hidden"); });
    act(() => { vi.advanceTimersByTime(30 * 60_000); });
    expect(result.current.toISOString()).toBe(initial);

    act(() => { setVisibility("visible"); });
    expect(result.current.toISOString()).toBe("2026-04-26T10:30:00.000Z");
  });
});

describe("useVisibilityAwareInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("fires at the configured cadence while visible", () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityAwareInterval(cb, 1000));

    act(() => { vi.advanceTimersByTime(3500); });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("stops firing while hidden and resumes when visible (without firing immediately)", () => {
    const cb = vi.fn();
    renderHook(() => useVisibilityAwareInterval(cb, 1000));

    act(() => { vi.advanceTimersByTime(2500); });
    expect(cb).toHaveBeenCalledTimes(2);

    act(() => { setVisibility("hidden"); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(cb).toHaveBeenCalledTimes(2); // no ticks while hidden

    act(() => { setVisibility("visible"); });
    // Resuming should NOT fire the callback synchronously — only on the
    // next interval tick.
    expect(cb).toHaveBeenCalledTimes(2);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("uses the latest callback identity without resetting the interval", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useVisibilityAwareInterval(cb, 1000),
      { initialProps: { cb: cb1 } },
    );

    act(() => { vi.advanceTimersByTime(1500); });
    expect(cb1).toHaveBeenCalledTimes(1);

    rerender({ cb: cb2 });
    act(() => { vi.advanceTimersByTime(1000); });
    // Latest callback fires on the next tick; old callback never fires again.
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});
