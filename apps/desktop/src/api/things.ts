import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { Thing, CreateItemInput, UpdateItemInput } from "@brett/types";
import { apiFetch } from "./client";

interface ThingsFilters {
  listId?: string;
  type?: string;
  status?: string;
  source?: string;
}

function buildQuery(filters?: ThingsFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.listId) params.set("listId", filters.listId);
  if (filters.type) params.set("type", filters.type);
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useThings(filters?: ThingsFilters) {
  return useQuery({
    queryKey: ["things", filters ?? {}],
    queryFn: () => apiFetch<Thing[]>(`/things${buildQuery(filters)}`),
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
    },
  });
}

export function useDeleteThing() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/things/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}
