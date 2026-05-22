/**
 * Regression tests for the v2 briefing client. The v1 streaming
 * implementation suffered an overnight-skeleton bug (cache stuck on
 * yesterday's value); v2 removes streaming entirely but keeps the
 * day-keyed cache to preserve the same midnight behavior. We also test
 * that `staleness === "dirty"` triggers exactly one /refresh POST per
 * dirty state — without that, focus-driven refetches could fire the
 * pipeline multiple times in a row.
 *
 * See docs/superpowers/specs/2026-05-16-briefing-pipeline-v2-design.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let mockTodayKey = "2026-05-16T00:00:00.000Z";
vi.mock("../../hooks/useTodayKey", () => ({
  useTodayKey: () => mockTodayKey,
}));

vi.mock("../ai-config", () => ({
  useAIConfigs: () => ({
    data: { configs: [{ isActive: true, isValid: true }] },
  }),
}));

vi.mock("../client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../client";
import { useBriefing } from "../briefing";

const mockApiFetch = vi.mocked(apiFetch);

function setupQueryClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

beforeEach(() => {
  mockTodayKey = "2026-05-16T00:00:00.000Z";
  // Default: cache miss, server says we need to refresh.
  mockApiFetch.mockResolvedValue({ briefing: null, staleness: "dirty" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useBriefing v2", () => {
  it("uses a queryKey that includes todayKey so cache rolls at midnight", async () => {
    const { qc, wrapper } = setupQueryClient();
    renderHook(() => useBriefing(), { wrapper });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith("/brett/briefing/current");
    });

    const briefingKeys = qc
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey)
      .filter((k) => Array.isArray(k) && k[0] === "briefing");
    expect(briefingKeys.length).toBeGreaterThanOrEqual(1);
    expect(briefingKeys.flat()).toContain(mockTodayKey);
  });

  it("fires POST /refresh exactly once when staleness is dirty", async () => {
    const { wrapper } = setupQueryClient();
    renderHook(() => useBriefing(), { wrapper });

    await waitFor(() => {
      // 1 GET /current + 1 POST /refresh
      expect(mockApiFetch).toHaveBeenCalledWith("/brett/briefing/current");
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/brett/briefing/refresh",
        { method: "POST" },
      );
    });

    const refreshCalls = mockApiFetch.mock.calls.filter(
      (c) => c[0] === "/brett/briefing/refresh",
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it("does NOT fire /refresh when staleness is fresh", async () => {
    mockApiFetch.mockResolvedValue({
      briefing: {
        content: "Quiet morning. Nothing changed overnight.",
        isEmpty: false,
        generatedAt: "2026-05-16T07:00:00.000Z",
      },
      staleness: "fresh",
    });

    const { wrapper } = setupQueryClient();
    renderHook(() => useBriefing(), { wrapper });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith("/brett/briefing/current");
    });

    // Give the dirty-detection effect a chance to run; it MUST NOT fire.
    await new Promise((r) => setTimeout(r, 50));
    const refreshCalls = mockApiFetch.mock.calls.filter(
      (c) => c[0] === "/brett/briefing/refresh",
    );
    expect(refreshCalls).toHaveLength(0);
  });

  // Regression guard for the briefing-skeleton-flash-on-rollover bug, same
  // class as the Today-list fix in #189. The briefing queryKey embeds
  // todayKey, so when the local day rolls over the key transitions to a
  // brand-new cache entry. Without placeholderData: keepPreviousData the
  // briefing surface gets isLoading=true and content=null, which causes
  // DailyBriefing to swap the prose for <BriefingProseSkeleton />. With
  // keepPreviousData the previous day's prose stays visible until the
  // new fetch lands, then swaps in place — no skeleton flash.
  it("keeps yesterday's briefing content visible while today's fetches across midnight rollover", async () => {
    let fetchCount = 0;
    mockApiFetch.mockImplementation((url: string) => {
      if (url !== "/brett/briefing/current") return Promise.resolve(undefined);
      fetchCount += 1;
      if (fetchCount === 1) {
        return Promise.resolve({
          briefing: {
            content: "Yesterday's briefing prose.",
            isEmpty: false,
            generatedAt: "2026-05-16T07:00:00.000Z",
          },
          staleness: "fresh",
        });
      }
      // Subsequent fetch (for the new day's key) hangs forever so we can
      // assert what the hook is showing DURING the key transition.
      return new Promise(() => {});
    });

    const { wrapper } = setupQueryClient();
    const { result, rerender } = renderHook(() => useBriefing(), { wrapper });

    await waitFor(() => {
      expect(result.current.content).toBe("Yesterday's briefing prose.");
      expect(result.current.isLoading).toBe(false);
    });

    // Simulate the local day rolling over — the next render uses the new key.
    mockTodayKey = "2026-05-17T00:00:00.000Z";
    rerender();

    // Critical assertion: even though the new key has no cached data and
    // its fetch is hanging, the previous day's prose is still showing
    // and isLoading remains false. No skeleton flash.
    expect(result.current.content).toBe("Yesterday's briefing prose.");
    expect(result.current.isLoading).toBe(false);
  });

  it("does NOT fire /refresh when staleness is capped (within 30min floor or 6/day ceiling)", async () => {
    mockApiFetch.mockResolvedValue({
      briefing: {
        content: "Quiet morning.",
        isEmpty: true,
        generatedAt: "2026-05-16T07:00:00.000Z",
      },
      staleness: "capped",
    });

    const { wrapper } = setupQueryClient();
    renderHook(() => useBriefing(), { wrapper });

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith("/brett/briefing/current");
    });

    await new Promise((r) => setTimeout(r, 50));
    const refreshCalls = mockApiFetch.mock.calls.filter(
      (c) => c[0] === "/brett/briefing/refresh",
    );
    expect(refreshCalls).toHaveLength(0);
  });
});
