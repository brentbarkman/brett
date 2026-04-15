import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("resolves to 'play' on first call with valid baseUrl", () => {
    const { result } = renderHook(() =>
      useAwakening({ baseUrl: "https://cdn.test" })
    );
    expect(result.current.status).toBe("play");
  });

  it("resolves to 'skip' on second call within the same session", () => {
    renderHook(() => useAwakening({ baseUrl: "https://cdn.test" }));
    const { result } = renderHook(() =>
      useAwakening({ baseUrl: "https://cdn.test" })
    );
    expect(result.current.status).toBe("skip");
  });

  it("resolves to 'skip' synchronously when prefers-reduced-motion is set", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock(true),
    });
    const { result } = renderHook(() =>
      useAwakening({ baseUrl: "https://cdn.test" })
    );
    expect(result.current.status).toBe("skip");
  });

  it("starts 'pending' when baseUrl is empty", () => {
    const { result } = renderHook(() => useAwakening({ baseUrl: "" }));
    expect(result.current.status).toBe("pending");
  });

  it("transitions pending → play when baseUrl arrives via rerender", () => {
    const { result, rerender } = renderHook(
      ({ baseUrl }: { baseUrl: string }) => useAwakening({ baseUrl }),
      { initialProps: { baseUrl: "" } }
    );
    expect(result.current.status).toBe("pending");
    rerender({ baseUrl: "https://cdn.test" });
    expect(result.current.status).toBe("play");
  });
});
