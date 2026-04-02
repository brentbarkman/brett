import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { Thing, ThingDetail, CreateItemInput, UpdateItemInput, InboxResponse, BulkUpdateInput } from "@brett/types";
import { getTodayUTC } from "@brett/business";
import { apiFetch } from "./client";
import { invalidateAllThings } from "./invalidate";

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

export function useThingDetail(id: string | null) {
  return useQuery({
    queryKey: ["thing-detail", id],
    queryFn: () => apiFetch<ThingDetail>(`/things/${id}`),
    enabled: !!id,
  });
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
    queryKey: ["things", { listId }],
    queryFn: () => apiFetch<Thing[]>(`/things?listId=${listId}`),
    enabled: !!listId,
  });
}

/** Active items with due dates after today (for Upcoming view) */
export function useUpcomingThings() {
  return useThings({ status: "active", dueAfter: getTodayUTC().toISOString() });
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
      invalidateAllThings(qc);
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
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["thing-detail", variables.id] });
    },
  });
}

export function useToggleThing() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Thing>(`/things/${id}/toggle`, { method: "PATCH" }),
    onMutate: async (id) => {
      // Optimistically remove from inbox cache so the item doesn't
      // flash back after the slide-out animation completes
      await qc.cancelQueries({ queryKey: ["inbox"] });
      const prev = qc.getQueryData<InboxResponse>(["inbox"]);
      if (prev) {
        qc.setQueryData<InboxResponse>(["inbox"], {
          visible: prev.visible.filter((t) => t.id !== id),
        });
      }

      // Optimistically toggle item status in any cached granola meeting
      await qc.cancelQueries({ queryKey: ["granola", "meeting"] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meetingQueries = qc.getQueriesData<any>({ queryKey: ["granola", "meeting"] });
      for (const [key, data] of meetingQueries) {
        if (data?.items) {
          const item = data.items.find((i: { id: string }) => i.id === id);
          if (item) {
            qc.setQueryData(key, {
              ...data,
              items: data.items.map((i: { id: string; status: string }) =>
                i.id === id
                  ? { ...i, status: i.status === "done" ? "active" : "done" }
                  : i,
              ),
            });
          }
        }
      }

      return { prev };
    },
    onError: (_err, _id, context) => {
      // Revert on error
      if (context?.prev) {
        qc.setQueryData(["inbox"], context.prev);
      }
    },
    onSettled: () => {
      invalidateAllThings(qc);
      qc.invalidateQueries({ queryKey: ["granola", "meeting"] });
    },
  });
}

export function useInboxThings() {
  return useQuery({
    queryKey: ["inbox"],
    queryFn: () => apiFetch<InboxResponse>("/things/inbox"),
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
      invalidateAllThings(qc);
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

export function useRetryExtraction() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      const res = await apiFetch<{ status: string }>(`/things/${itemId}/extract`, {
        method: "POST",
      });
      return res;
    },
    onSuccess: (_data, itemId) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
  });
}

export function useListSuggestions(itemId: string | null) {
  return useQuery({
    queryKey: ["list-suggestions", itemId],
    queryFn: () =>
      apiFetch<{ suggestions: Array<{ listId: string; listName: string; similarity: number }> }>(
        `/things/${itemId}/list-suggestions`
      ),
    enabled: !!itemId,
  });
}

export function useDeleteThing() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/things/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateAllThings(qc);
    },
  });
}
