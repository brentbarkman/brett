import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAwakening, _resetAwakeningSessionFlag } from "../useAwakening";

const matchMediaMock = (matches: boolean) =>
  vi.fn().mockImplementation((q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? matches : false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

describe("useAwakening", () => {
  beforeEach(() => {
    _resetAwakeningSessionFlag();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock(false),
    });
  });

  it("resolves to 'play' when ready on mount", () => {
    const { result } = renderHook(() => useAwakening({ ready: true }));
    expect(result.current.status).toBe("play");
  });

  it("resolves to 'skip' on second call within the same session", () => {
    renderHook(() => useAwakening({ ready: true }));
    const { result } = renderHook(() => useAwakening({ ready: true }));
    expect(result.current.status).toBe("skip");
  });

  it("resolves to 'skip' synchronously when prefers-reduced-motion is set", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock(true),
    });
    const { result } = renderHook(() => useAwakening({ ready: true }));
    expect(result.current.status).toBe("skip");
  });

  it("starts 'pending' when not ready", () => {
    const { result } = renderHook(() => useAwakening({ ready: false }));
    expect(result.current.status).toBe("pending");
  });

  it("transitions pending → play when ready flips true", () => {
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useAwakening({ ready }),
      { initialProps: { ready: false } }
    );
    expect(result.current.status).toBe("pending");
    rerender({ ready: true });
    expect(result.current.status).toBe("play");
  });

  describe("cap timer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("caps wait and transitions to 'play' after maxWaitMs even if never ready", () => {
      const { result } = renderHook(() =>
        useAwakening({ ready: false, maxWaitMs: 500 })
      );
      expect(result.current.status).toBe("pending");
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(result.current.status).toBe("pending");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current.status).toBe("play");
    });

    it("cap timer does not override 'play' once ready has fired", () => {
      const { result, rerender } = renderHook(
        ({ ready }: { ready: boolean }) =>
          useAwakening({ ready, maxWaitMs: 500 }),
        { initialProps: { ready: false } }
      );
      rerender({ ready: true });
      expect(result.current.status).toBe("play");
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.status).toBe("play");
    });
  });
});
