import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAwakeningVideo, _resetAwakeningSessionFlag } from "../useAwakeningVideo";

vi.mock("../../data/awakening-manifest.json", () => ({
  default: {
    version: 1,
    videos: {
      dawn:       { mp4: "videos/awakening/dawn.mp4",       webm: "videos/awakening/dawn.webm" },
      morning:    { mp4: "videos/awakening/morning.mp4",    webm: "videos/awakening/morning.webm" },
      afternoon:  { mp4: "videos/awakening/afternoon.mp4",  webm: "videos/awakening/afternoon.webm" },
      goldenHour: { mp4: "videos/awakening/goldenHour.mp4", webm: "videos/awakening/goldenHour.webm" },
      evening:    { mp4: "videos/awakening/evening.mp4",    webm: "videos/awakening/evening.webm" },
      night:      { mp4: "videos/awakening/night.mp4",      webm: "videos/awakening/night.webm" },
    },
  },
}));

const matchMediaMock = (matches: boolean) =>
  vi.fn().mockImplementation((q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? matches : false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

describe("useAwakeningVideo", () => {
  beforeEach(() => {
    _resetAwakeningSessionFlag();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock(false),
    });
  });

  it("returns shouldPlay=true on first call with valid baseUrl + segment", () => {
    const { result } = renderHook(() =>
      useAwakeningVideo({ baseUrl: "https://cdn.test", segment: "morning" })
    );
    expect(result.current.shouldPlay).toBe(true);
    expect(result.current.videoUrls).toEqual([
      "https://cdn.test/videos/awakening/morning.webm",
      "https://cdn.test/videos/awakening/morning.mp4",
    ]);
  });

  it("returns shouldPlay=false on second call (already played in session)", () => {
    renderHook(() => useAwakeningVideo({ baseUrl: "https://cdn.test", segment: "morning" }));
    const { result } = renderHook(() =>
      useAwakeningVideo({ baseUrl: "https://cdn.test", segment: "evening" })
    );
    expect(result.current.shouldPlay).toBe(false);
  });

  it("returns shouldPlay=false when prefers-reduced-motion is set", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock(true),
    });
    const { result } = renderHook(() =>
      useAwakeningVideo({ baseUrl: "https://cdn.test", segment: "morning" })
    );
    expect(result.current.shouldPlay).toBe(false);
  });

  it("returns shouldPlay=false when baseUrl is empty", () => {
    const { result } = renderHook(() =>
      useAwakeningVideo({ baseUrl: "", segment: "morning" })
    );
    expect(result.current.shouldPlay).toBe(false);
  });
});
