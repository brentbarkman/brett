import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./client";
import type {
  Scout,
  ScoutFinding,
  ScoutMemory,
  CreateScoutInput,
  UpdateScoutInput,
  ActivityEntry,
  ScoutBudgetSummary,
  FindingType,
} from "@brett/types";

// ─── Queries ───

export function useScouts(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return useQuery({
    queryKey: ["scouts", status ?? null],
    queryFn: () => apiFetch<Scout[]>(`/scouts${qs}`),
  });
}

export function useScout(id: string | null) {
  return useQuery({
    queryKey: ["scout", id],
    queryFn: () => apiFetch<Scout>(`/scouts/${id}`),
    enabled: !!id,
  });
}

export function useScoutFindings(
  scoutId: string | null,
  options?: { type?: string; cursor?: string }
) {
  const params = new URLSearchParams();
  if (options?.type) params.set("type", options.type);
  if (options?.cursor) params.set("cursor", options.cursor);
  const qs = params.toString() ? `?${params.toString()}` : "";

  return useQuery({
    queryKey: ["scout-findings", scoutId, options?.type, options?.cursor],
    queryFn: () =>
      apiFetch<{ findings: ScoutFinding[]; total: number; cursor: string | null }>(
        `/scouts/${scoutId}/findings${qs}`
      ),
    enabled: !!scoutId,
  });
}

export function useScoutActivity(scoutId: string | null) {
  return useQuery({
    queryKey: ["scout-activity", scoutId],
    queryFn: () =>
      apiFetch<{ entries: ActivityEntry[]; cursor: string | null }>(
        `/scouts/${scoutId}/activity`
      ),
    enabled: !!scoutId,
  });
}

export function useScoutBudget() {
  return useQuery({
    queryKey: ["scout-budget"],
    queryFn: () => apiFetch<ScoutBudgetSummary>("/scouts/budget"),
  });
}

export function useScoutMemories(scoutId: string | undefined, type?: string) {
  return useQuery({
    queryKey: ["scout-memories", scoutId, type],
    queryFn: () => {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      const qs = params.toString();
      return apiFetch<ScoutMemory[]>(`/scouts/${scoutId}/memories${qs ? `?${qs}` : ""}`);
    },
    enabled: !!scoutId,
  });
}

// ─── Mutations ───

export function useCreateScout() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateScoutInput) =>
      apiFetch<Scout>("/scouts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scouts"] });
      qc.invalidateQueries({ queryKey: ["scout-budget"] });
    },
  });
}

export function useUpdateScout() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdateScoutInput & { id: string }) =>
      apiFetch<Scout>(`/scouts/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["scouts"] });
      qc.invalidateQueries({ queryKey: ["scout", variables.id] });
    },
  });
}

export function usePauseScout() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Scout>(`/scouts/${id}/pause`, { method: "POST" }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["scouts"] });
      qc.invalidateQueries({ queryKey: ["scout", id] });
    },
  });
}

export function useResumeScout() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Scout>(`/scouts/${id}/resume`, { method: "POST" }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["scouts"] });
      qc.invalidateQueries({ queryKey: ["scout", id] });
    },
  });
}

export function useDeleteScout() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/scouts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scouts"] });
      qc.invalidateQueries({ queryKey: ["scout-budget"] });
    },
  });
}

export function useTriggerScoutRun() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ status: string }>(`/scouts/${id}/run`, { method: "POST" }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["scouts"] });
      qc.invalidateQueries({ queryKey: ["scout", id] });
      qc.invalidateQueries({ queryKey: ["scout-activity", id] });
    },
  });
}

export function useTriggerConsolidation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ status: string }>(`/scouts/${id}/consolidate`, { method: "POST" }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["scout-memories", id] });
      qc.invalidateQueries({ queryKey: ["scout-activity", id] });
    },
  });
}

export function useClearScoutHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/scouts/${id}/history`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["scouts"] });
      qc.invalidateQueries({ queryKey: ["scout", id] });
      qc.invalidateQueries({ queryKey: ["scout-findings", id] });
      qc.invalidateQueries({ queryKey: ["scout-activity", id] });
      qc.invalidateQueries({ queryKey: ["scout-memories", id] });
    },
  });
}

export function useSubmitScoutFeedback() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ scoutId, findingId, useful }: { scoutId: string; findingId: string; useful: boolean | null }) =>
      apiFetch(`/scouts/${scoutId}/findings/${findingId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ useful }),
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["thing-detail"] });
      qc.invalidateQueries({ queryKey: ["scout-findings", variables.scoutId] });
    },
  });
}

export function useDeleteScoutMemory() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ scoutId, memoryId }: { scoutId: string; memoryId: string }) =>
      apiFetch(`/scouts/${scoutId}/memories/${memoryId}`, { method: "DELETE" }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["scout-memories", variables.scoutId] });
    },
  });
}

// ─── Recent Findings ───

export interface RecentFinding {
  id: string;
  scoutId: string;
  itemId?: string;
  type: FindingType;
  title: string;
  description: string;
  sourceUrl?: string;
  sourceName: string;
  relevanceScore: number;
  createdAt: string;
  scoutName: string;
  scoutAvatarLetter: string;
  scoutAvatarGradient: [string, string];
}

export function useRecentFindings(limit = 20) {
  return useQuery({
    queryKey: ["recent-findings", limit],
    queryFn: () =>
      apiFetch<{ findings: RecentFinding[] }>(
        `/scouts/findings/recent?limit=${limit}`
      ),
  });
}
