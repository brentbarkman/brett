import { useQuery, type QueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageSummaryPeriod {
  provider: string;
  model: string;
  source: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

interface UsageSummary {
  last24h: UsageSummaryPeriod[];
  last7d: UsageSummaryPeriod[];
  last30d: UsageSummaryPeriod[];
}

export function sessionUsageQueryKey(sessionId: string | null): readonly unknown[] {
  return ["ai-usage-session", sessionId] as const;
}

/**
 * Reads the running token total for the active chat session.
 *
 * Cache is updated in two places:
 *   - Initial fetch on mount (one HTTP round-trip).
 *   - Every `done` chunk in the chat stream consumer (`brett-chat`,
 *     `omnibar`) increments via `applyUsageDelta`.
 *
 * `staleTime: Infinity` keeps React Query from auto-refetching on focus or
 * remount — the stream is the source of truth between turns. We previously
 * polled every 5 seconds; that was the largest single source of background
 * battery drain. See packages/ai/src/orchestrator.ts for the round-end usage
 * delta.
 */
export function useSessionUsage(sessionId: string | null) {
  return useQuery({
    queryKey: sessionUsageQueryKey(sessionId),
    queryFn: () => apiFetch<SessionUsage>(`/ai/usage/session/${sessionId}`),
    enabled: !!sessionId,
    staleTime: Infinity,
  });
}

interface UsageDelta {
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
}

/**
 * Apply a per-round token-usage delta to the cached session total. Called
 * by the chat stream consumer when an orchestrator `done` chunk arrives.
 *
 * If the cache has never been populated (e.g. the chat opened mid-stream
 * before the initial fetch resolved), this is a no-op — the imminent
 * initial fetch will arrive with a fresh aggregate that already includes
 * this delta server-side.
 */
export function applyUsageDelta(
  qc: QueryClient,
  sessionId: string,
  delta: UsageDelta,
): void {
  qc.setQueryData<SessionUsage | undefined>(
    sessionUsageQueryKey(sessionId),
    (prev) => {
      if (!prev) return prev;
      const inputTokens = prev.inputTokens + delta.input;
      const outputTokens = prev.outputTokens + delta.output;
      const cacheTokens = (delta.cacheCreation ?? 0) + (delta.cacheRead ?? 0);
      return {
        inputTokens,
        outputTokens,
        totalTokens: prev.totalTokens + delta.input + delta.output + cacheTokens,
      };
    },
  );
}

export function useUsageSummary() {
  return useQuery({
    queryKey: ["ai-usage-summary"],
    queryFn: () => apiFetch<UsageSummary>("/ai/usage/summary"),
    staleTime: 60_000,
  });
}
