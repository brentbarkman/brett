import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "./client";

export function useAdminScouts(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return useQuery({
    queryKey: ["admin", "scouts", status ?? "all"],
    queryFn: () => adminFetch<{ scouts: any[] }>(`/admin/scouts${qs}`),
  });
}

export function useAdminScoutRuns(limit = 50) {
  return useQuery({
    queryKey: ["admin", "scout-runs", limit],
    queryFn: () => adminFetch<{ runs: any[] }>(`/admin/scouts/runs?limit=${limit}`),
  });
}

export function usePauseScout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scoutId: string) =>
      adminFetch(`/admin/scouts/${scoutId}/pause`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "scouts"] }),
  });
}

export function useResumeScout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scoutId: string) =>
      adminFetch(`/admin/scouts/${scoutId}/resume`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "scouts"] }),
  });
}

export function usePauseAllScouts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminFetch("/admin/scouts/pause-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "scouts"] }),
  });
}

export function useResumeAllScouts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminFetch("/admin/scouts/resume-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "scouts"] }),
  });
}
