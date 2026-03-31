import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "./client";
import type {
  Scout,
  ScoutFinding,
  CreateScoutInput,
  UpdateScoutInput,
  ActivityEntry,
  ScoutBudgetSummary,
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
    queryKey: ["scout-findings", scoutId, options ?? {}],
    queryFn: () => apiFetch<ScoutFinding[]>(`/scouts/${scoutId}/findings${qs}`),
    enabled: !!scoutId,
  });
}

export function useScoutActivity(scoutId: string | null) {
  return useQuery({
    queryKey: ["scout-activity", scoutId],
    queryFn: () => apiFetch<ActivityEntry[]>(`/scouts/${scoutId}/activity`),
    enabled: !!scoutId,
  });
}

export function useScoutBudget() {
  return useQuery({
    queryKey: ["scout-budget"],
    queryFn: () => apiFetch<ScoutBudgetSummary>("/scouts/budget"),
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

export function useDismissFinding() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ scoutId, findingId }: { scoutId: string; findingId: string }) =>
      apiFetch<ScoutFinding>(`/scouts/${scoutId}/findings/${findingId}/dismiss`, {
        method: "POST",
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["scout-findings", variables.scoutId] });
    },
  });
}

export function usePromoteFinding() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ scoutId, findingId }: { scoutId: string; findingId: string }) =>
      apiFetch<ScoutFinding>(`/scouts/${scoutId}/findings/${findingId}/promote`, {
        method: "POST",
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["scout-findings", variables.scoutId] });
    },
  });
}
