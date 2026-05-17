import { useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { useAIConfigs } from "./ai-config";
import { useTodayKey } from "../hooks/useTodayKey";

// ─── Types ───
//
// New v2 contract — single endpoint, no streaming. The server returns
// the cached briefing instantly + a `staleness` flag the client uses to
// decide whether to fire a background refresh.
// See docs/superpowers/specs/2026-05-16-briefing-pipeline-v2-design.md.

interface BriefingCurrentResponse {
  briefing: {
    content: string;
    isEmpty: boolean;
    generatedAt: string;
  } | null;
  staleness: "fresh" | "dirty" | "capped";
}

interface BriefingSummaryResponse {
  overdueTasks: number;
  dueTodayTasks: number;
  todayEvents: number;
  overdueItems: Array<{ title: string; dueDate: string }>;
}

// How long to wait after firing /refresh before refetching the cached
// row. The pipeline usually completes in 2-4s end-to-end (Haiku detector
// then maybe Sonnet writer); a single delayed refetch picks up the new
// content without polling.
const REFETCH_DELAY_MS = 2_500;

// ─── Briefing Hook ───

export function useBriefing() {
  const qc = useQueryClient();
  const refreshFiredRef = useRef(false);

  const { data: aiConfigData } = useAIConfigs();
  const hasAI = (aiConfigData?.configs ?? []).some(
    (c) => c.isActive && c.isValid,
  );

  // todayKey participates in the cache key so the briefing flips to a
  // fresh entry at local-midnight rollover. The server-side cache also
  // handles this, but we want the client to drop any stale "fresh"-state
  // from yesterday immediately when the day changes.
  const todayKey = useTodayKey();

  const briefingQuery = useQuery({
    queryKey: ["briefing", todayKey],
    queryFn: () =>
      apiFetch<BriefingCurrentResponse>("/brett/briefing/current"),
    enabled: hasAI,
    // Refetch when the window regains focus so the morning bootstrap
    // (server-side 7am cron) is picked up the moment the user re-engages
    // the app, without needing a full reload.
    refetchOnWindowFocus: true,
  });

  const cached = briefingQuery.data?.briefing ?? null;
  const staleness = briefingQuery.data?.staleness ?? "fresh";

  // When the server reports `dirty`, fire a background refresh and
  // schedule a refetch. `refreshFiredRef` prevents thrash: even with
  // multiple focus events, we don't keep firing refresh for the same
  // dirty-state. The ref clears every time the cached `generatedAt`
  // changes — meaning the server has produced a new briefing.
  const lastRefreshedAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasAI) return;
    if (staleness !== "dirty") return;
    if (refreshFiredRef.current) return;

    refreshFiredRef.current = true;
    apiFetch<void>("/brett/briefing/refresh", { method: "POST" }).catch(
      (err) => console.error("[briefing] refresh failed:", err),
    );

    const t = setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["briefing"] });
    }, REFETCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [hasAI, staleness, qc]);

  // Reset the refresh latch when the server produces a new briefing, so
  // a subsequent dirty event can trigger another refresh later.
  useEffect(() => {
    const stamp = cached?.generatedAt ?? null;
    if (stamp && stamp !== lastRefreshedAtRef.current) {
      lastRefreshedAtRef.current = stamp;
      refreshFiredRef.current = false;
    }
  }, [cached?.generatedAt]);

  // Manual regenerate (hover-only RefreshCw button on the hero). Fires
  // the same /refresh endpoint; server-side gates (30min floor, 6/day
  // ceiling) still apply, so a rapid click does not burn tokens.
  const regenerate = useCallback(async () => {
    try {
      await apiFetch<void>("/brett/briefing/refresh", { method: "POST" });
    } catch (err) {
      console.error("[briefing] manual regenerate failed:", err);
    }
    setTimeout(
      () => qc.invalidateQueries({ queryKey: ["briefing"] }),
      REFETCH_DELAY_MS,
    );
  }, [qc]);

  return {
    content: cached?.content ?? null,
    isLoading: briefingQuery.isLoading,
    isError: briefingQuery.isError,
    hasAI,
    hasBriefing: !!cached,
    generatedAt: cached?.generatedAt ?? null,
    staleness,
    regenerate,
  };
}

// ─── Summary Hook (no AI required) ───

export function useBriefingSummary() {
  return useQuery({
    queryKey: ["briefing-summary"],
    queryFn: () => apiFetch<BriefingSummaryResponse>("/brett/briefing/summary"),
  });
}
