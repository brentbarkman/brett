import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { Thing, CreateItemInput, UpdateItemInput, InboxResponse, BulkUpdateInput } from "@brett/types";
import { apiFetch } from "./client";

interface ThingsFilters {
  listId?: string;
  type?: string;
  status?: string;
  source?: string;
  dueBefore?: string;
  dueAfter?: string;
  completedAfter?: string;
}

function buildQuery(filters?: ThingsFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.listId) params.set("listId", filters.listId);
  if (filters.type) params.set("type", filters.type);
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  if (filters.dueBefore) params.set("dueBefore", filters.dueBefore);
  if (filters.dueAfter) params.set("dueAfter", filters.dueAfter);
  if (filters.completedAfter) params.set("completedAfter", filters.completedAfter);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useThings(filters?: ThingsFilters) {
  return useQuery({
    queryKey: ["things", filters ?? {}],
    queryFn: () => apiFetch<Thing[]>(`/things${buildQuery(filters)}`),
  });
}

/** Active items due on or before a date */
export function useActiveThings(dueBefore: string) {
  return useThings({ status: "active", dueBefore });
}

/** Items completed on or after a date */
export function useDoneThings(completedAfter: string) {
  return useThings({ status: "done", completedAfter });
}

/** Things belonging to a specific list */
export function useListThings(listId: string) {
  return useQuery({
    queryKey: ["things", "list", listId],
    queryFn: () => apiFetch<Thing[]>(`/things?listId=${listId}`),
    enabled: !!listId,
  });
}

export function useCreateThing() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateItemInput) =>
      apiFetch<Thing>("/things", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useUpdateThing() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: UpdateItemInput & { id: string }) =>
      apiFetch<Thing>(`/things/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });
}

export function useToggleThing() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Thing>(`/things/${id}/toggle`, { method: "PATCH" }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useInboxThings(includeHidden = false) {
  return useQuery({
    queryKey: ["inbox", { includeHidden }],
    queryFn: () =>
      apiFetch<InboxResponse>(
        `/things/inbox${includeHidden ? "?includeHidden=true" : ""}`
      ),
  });
}

export function useBulkUpdateThings() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: BulkUpdateInput) =>
      apiFetch<{ updated: number }>("/things/bulk", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useArchiveThings() {
  const bulkUpdate = useBulkUpdateThings();

  return {
    ...bulkUpdate,
    mutate: (ids: string[]) =>
      bulkUpdate.mutate({ ids, updates: { status: "archived" } }),
    mutateAsync: (ids: string[]) =>
      bulkUpdate.mutateAsync({ ids, updates: { status: "archived" } }),
  };
}

export function useDeleteThing() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/things/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}
