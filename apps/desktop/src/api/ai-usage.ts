import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

interface SessionUsage {
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

export function useSessionUsage(sessionId: string | null) {
  return useQuery({
    queryKey: ["ai-usage-session", sessionId],
    queryFn: () => apiFetch<SessionUsage>(`/ai/usage/session/${sessionId}`),
    enabled: !!sessionId,
    refetchInterval: 5000,
  });
}

export function useUsageSummary() {
  return useQuery({
    queryKey: ["ai-usage-summary"],
    queryFn: () => apiFetch<UsageSummary>("/ai/usage/summary"),
    staleTime: 60_000,
  });
}
