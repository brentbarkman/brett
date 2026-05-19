import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTonightExpansion } from "../lib/useTonightAutoExpand";

/**
 * The hook drives whether the Today view's Tonight section is open or
 * collapsed. The rules are intentionally tested at the level the user
 * cares about — "what does the section show when I open Today at X
 * o'clock?" — not at the localStorage-key level.
 */

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTonightExpansion", () => {
  it("defaults closed before 6pm local when the user hasn't touched it today", () => {
    vi.setSystemTime(new Date("2026-05-18T17:30:00"));
    const { result } = renderHook(() => useTonightExpansion());
    expect(result.current[0]).toBe(false);
  });

  it("defaults open at 6pm or later when the user hasn't touched it today", () => {
    vi.setSystemTime(new Date("2026-05-18T18:00:00"));
    const { result } = renderHook(() => useTonightExpansion());
    expect(result.current[0]).toBe(true);
  });

  it("respects a manual collapse after 6pm — sticky for the rest of the day", () => {
    // User opens the app at 8pm; the section auto-opens. They explicitly
    // collapse it. Until midnight (the date key changes) the auto rule
    // must not re-open it on the next mount.
    vi.setSystemTime(new Date("2026-05-18T20:00:00"));
    const { result } = renderHook(() => useTonightExpansion());
    expect(result.current[0]).toBe(true);

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    // Re-mount — the persisted user override must win over the auto rule.
    const { result: result2 } = renderHook(() => useTonightExpansion());
    expect(result2.current[0]).toBe(false);
  });

  it("starts fresh on a new local calendar date", () => {
    // Day 1: user collapses after 6pm.
    vi.setSystemTime(new Date("2026-05-18T20:00:00"));
    const { result } = renderHook(() => useTonightExpansion());
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);

    // Day 2 morning: a brand-new mount on a new date must reset to the
    // pre-6pm auto default (closed), NOT carry the previous day's override.
    vi.setSystemTime(new Date("2026-05-19T09:00:00"));
    const { result: result2 } = renderHook(() => useTonightExpansion());
    expect(result2.current[0]).toBe(false); // pre-6pm default

    // …and at 6pm on day 2, the auto rule re-applies because the day-2 key
    // hasn't been touched.
    vi.setSystemTime(new Date("2026-05-19T18:30:00"));
    const { result: result3 } = renderHook(() => useTonightExpansion());
    expect(result3.current[0]).toBe(true);
  });
});
