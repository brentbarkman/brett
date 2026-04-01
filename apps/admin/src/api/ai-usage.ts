import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "./client";

export function useAIUsage(days = 30) {
  return useQuery({
    queryKey: ["admin", "ai-usage", days],
    queryFn: () => adminFetch<{ days: number; totalTokens: number; totalCostUsd: number; totalCalls: number; byModel: any; byFeature: any }>(`/admin/ai/usage?days=${days}`),
  });
}

export function useAIUsageDaily(days = 30) {
  return useQuery({
    queryKey: ["admin", "ai-usage-daily", days],
    queryFn: () => adminFetch<{ days: number; daily: any[] }>(`/admin/ai/usage/daily?days=${days}`),
  });
}

export function useAISessions(limit = 25) {
  return useQuery({
    queryKey: ["admin", "ai-sessions", limit],
    queryFn: () => adminFetch<{ sessions: any[] }>(`/admin/ai/sessions?limit=${limit}`),
  });
}
