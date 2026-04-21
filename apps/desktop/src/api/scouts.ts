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

/** Patch every cached scout list and the per-scout detail in place. */
function patchScoutInCaches(qc: ReturnType<typeof useQueryClient>, id: string, patch: Partial<Scout>) {
  const prevDetail = qc.getQueryData<Scout>(["scout", id]);
  if (prevDetail) {
    qc.setQueryData<Scout>(["scout", id], { ...prevDetail, ...patch });
  }
  const prevLists: Array<[readonly unknown[], Scout[] | undefined]> = [];
  for (const [key, data] of qc.getQueriesData<Scout[]>({ queryKey: ["scouts"] })) {
    if (!data) continue;
    prevLists.push([key, data]);
    qc.setQueryData<Scout[]>(key, data.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  return { prevDetail, prevLists };
}

function restoreScoutCaches(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
  ctx: { prevDetail?: Scout; prevLists?: Array<[readonly unknown[], Scout[] | undefined]> } | undefined,
) {
  if (ctx?.prevDetail !== undefined) qc.setQueryData<Scout>(["scout", id], ctx.prevDetail);
  if (ctx?.prevLists) {
    for (const [key, data] of ctx.prevLists) qc.setQueryData(key, data);
  }
}

export function useUpdateScout() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdateScoutInput & { id: string }) =>
      apiFetch<Scout>(`/scouts/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: ["scout", id] });
      await qc.cancelQueries({ queryKey: ["scouts"] });
      return patchScoutInCaches(qc, id, patch as Partial<Scout>);
    },
    onError: (_err, { id }, ctx) => restoreScoutCaches(qc, id, ctx),
    onSettled: (_data, _err, { id }) => {
      qc.invalidateQueries({ queryKey: ["scouts"] });
      qc.invalidateQueries({ queryKey: ["scout", id] });
    },
  });
}

export function usePauseScout() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Scout>(`/scouts/${id}/pause`, { method: "POST" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["scout", id] });
      await qc.cancelQueries({ queryKey: ["scouts"] });
      return patchScoutInCaches(qc, id, { status: "paused" });
    },
    onError: (_err, id, ctx) => restoreScoutCaches(qc, id, ctx),
    onSettled: (_data, _err, id) => {
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["scout", id] });
      await qc.cancelQueries({ queryKey: ["scouts"] });
      return patchScoutInCaches(qc, id, { status: "active" });
    },
    onError: (_err, id, ctx) => restoreScoutCaches(qc, id, ctx),
    onSettled: (_data, _err, id) => {
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["scouts"] });
      const prevLists: Array<[readonly unknown[], Scout[] | undefined]> = [];
      for (const [key, data] of qc.getQueriesData<Scout[]>({ queryKey: ["scouts"] })) {
        if (!data) continue;
        prevLists.push([key, data]);
        qc.setQueryData<Scout[]>(key, data.filter((s) => s.id !== id));
      }
      return { prevLists };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevLists) {
        for (const [key, data] of ctx.prevLists) qc.setQueryData(key, data);
      }
    },
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: ["scouts"] });
      qc.invalidateQueries({ queryKey: ["scout-budget"] });
      qc.removeQueries({ queryKey: ["scout", id] });
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
    onMutate: async ({ scoutId, memoryId }) => {
      await qc.cancelQueries({ queryKey: ["scout-memories", scoutId] });
      const prevEntries: Array<[readonly unknown[], ScoutMemory[] | undefined]> = [];
      for (const [key, data] of qc.getQueriesData<ScoutMemory[]>({ queryKey: ["scout-memories", scoutId] })) {
        if (!data) continue;
        prevEntries.push([key, data]);
        qc.setQueryData<ScoutMemory[]>(key, data.filter((m) => m.id !== memoryId));
      }
      return { prevEntries };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prevEntries) {
        for (const [key, data] of ctx.prevEntries) qc.setQueryData(key, data);
      }
    },
    onSettled: (_data, _err, variables) => {
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
