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

/** Shape a CreateItemInput into a provisional Thing for optimistic caches. */
function provisionalThing(input: CreateItemInput, tempId: string): Thing {
  return {
    id: tempId,
    type: (input.type as Thing["type"]) ?? "task",
    title: input.title,
    list: "Inbox",
    listId: input.listId ?? null,
    status: (input.status as Thing["status"]) ?? "active",
    source: input.source ?? "manual",
    urgency: "later",
    dueDate: input.dueDate,
    dueDatePrecision: input.dueDatePrecision,
    sourceUrl: input.sourceUrl,
    isCompleted: false,
    createdAt: new Date().toISOString(),
    contentType: input.contentType,
    sourceId: input.sourceId,
  };
}

// Mirrors the server filter semantics in apps/api/src/routes/things.ts:
//   dueBefore: dueDate <= value   dueAfter: dueDate > value
//   completedAfter: completedAt >= value   (null sides fail the predicate)
// Drift is bounded — onSettled invalidates and refetches from the server,
// so at worst we briefly show a new item in the wrong cache.
function thingMatchesFilters(thing: Thing, filters: ThingsFilters): boolean {
  if (filters.listId && thing.listId !== filters.listId) return false;
  if (filters.type && thing.type !== filters.type) return false;
  if (filters.status && thing.status !== filters.status) return false;
  if (filters.source && thing.source !== filters.source) return false;
  if (filters.dueBefore) {
    if (!thing.dueDate) return false;
    if (new Date(thing.dueDate).getTime() > new Date(filters.dueBefore).getTime()) return false;
  }
  if (filters.dueAfter) {
    if (!thing.dueDate) return false;
    if (new Date(thing.dueDate).getTime() <= new Date(filters.dueAfter).getTime()) return false;
  }
  if (filters.completedAfter) {
    // Provisional creates are never pre-completed, so they never belong in a
    // completedAfter view.
    return false;
  }
  return true;
}

export const __testing = { thingMatchesFilters };

export function useCreateThing() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateItemInput) =>
      apiFetch<Thing>("/things", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    // Optimistically prepend the new item into every cached view it
    // belongs in: the inbox (when inbox-bound) and every ["things", ...]
    // list-query cache whose filters the provisional thing satisfies.
    // onSettled invalidates and refetches, so any client/server filter
    // drift is self-correcting within one round-trip.
    onMutate: async (input) => {
      const isInboxBound = !input.listId && !input.dueDate;
      const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const provisional = provisionalThing(input, tempId);

      await qc.cancelQueries({ queryKey: ["inbox"] });
      await qc.cancelQueries({ queryKey: ["things"] });

      let prevInbox: InboxResponse | undefined;
      if (isInboxBound) {
        prevInbox = qc.getQueryData<InboxResponse>(["inbox"]);
        qc.setQueryData<InboxResponse>(["inbox"], {
          visible: [provisional, ...(prevInbox?.visible ?? [])],
        });
      }

      const prevThingLists: Array<[readonly unknown[], Thing[] | undefined]> = [];
      for (const [key, data] of qc.getQueriesData<Thing[]>({ queryKey: ["things"] })) {
        const filters = (key[1] ?? {}) as ThingsFilters;
        if (!thingMatchesFilters(provisional, filters)) continue;
        prevThingLists.push([key, data]);
        qc.setQueryData<Thing[]>(key, [provisional, ...(data ?? [])]);
      }

      return { prevInbox, prevThingLists, tempId };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prevInbox !== undefined) {
        qc.setQueryData<InboxResponse>(["inbox"], ctx.prevInbox);
      }
      if (ctx?.prevThingLists) {
        for (const [key, data] of ctx.prevThingLists) {
          qc.setQueryData(key, data);
        }
      }
    },
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
    // Patch cached views in place so edits (e.g. title) render instantly
    // instead of flashing back to the server value while refetch completes.
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: ["thing-detail", id] });
      await qc.cancelQueries({ queryKey: ["inbox"] });
      await qc.cancelQueries({ queryKey: ["things"] });

      // `UpdateItemInput` permits `null` for clear-value semantics, but the
      // view-model `Thing` uses `undefined` for absent fields. Normalise
      // before merging into cache so optimistic entries stay well-typed.
      const thingPatch = Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [k, v === null ? undefined : v]),
      ) as Partial<Thing>;

      const prevDetail = qc.getQueryData<ThingDetail>(["thing-detail", id]);
      if (prevDetail) {
        qc.setQueryData<ThingDetail>(["thing-detail", id], { ...prevDetail, ...thingPatch });
      }

      const prevInbox = qc.getQueryData<InboxResponse>(["inbox"]);
      if (prevInbox) {
        qc.setQueryData<InboxResponse>(["inbox"], {
          visible: prevInbox.visible.map((t) => (t.id === id ? { ...t, ...thingPatch } : t)),
        });
      }

      const prevThingLists: Array<[readonly unknown[], Thing[] | undefined]> = [];
      for (const [key, data] of qc.getQueriesData<Thing[]>({ queryKey: ["things"] })) {
        prevThingLists.push([key, data]);
        if (!data) continue;
        qc.setQueryData<Thing[]>(
          key,
          data.map((t) => (t.id === id ? { ...t, ...thingPatch } : t)),
        );
      }

      return { prevDetail, prevInbox, prevThingLists };
    },
    onError: (_err, variables, ctx) => {
      if (ctx?.prevDetail) {
        qc.setQueryData<ThingDetail>(["thing-detail", variables.id], ctx.prevDetail);
      }
      if (ctx?.prevInbox !== undefined) {
        qc.setQueryData<InboxResponse>(["inbox"], ctx.prevInbox);
      }
      if (ctx?.prevThingLists) {
        for (const [key, data] of ctx.prevThingLists) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: (_data, _err, variables) => {
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
    // Drives drag-to-list, inbox triage, archive, bulk status changes. An
    // in-place patch is good enough for all of those — if a cache's filter
    // semantics shift (e.g. moving an item between lists), onSettled
    // reconciles with the server.
    onMutate: async ({ ids, updates }) => {
      await qc.cancelQueries({ queryKey: ["things"] });
      await qc.cancelQueries({ queryKey: ["inbox"] });

      const idSet = new Set(ids);
      const thingPatch = Object.fromEntries(
        Object.entries(updates).map(([k, v]) => [k, v === null ? undefined : v]),
      ) as Partial<Thing>;
      if (updates.status) {
        thingPatch.isCompleted = updates.status === "done";
      }
      const removeFromInbox = updates.status === "archived" || updates.status === "done";

      const prevInbox = qc.getQueryData<InboxResponse>(["inbox"]);
      if (prevInbox) {
        const nextVisible = removeFromInbox
          ? prevInbox.visible.filter((t) => !idSet.has(t.id))
          : prevInbox.visible.map((t) => (idSet.has(t.id) ? { ...t, ...thingPatch } : t));
        qc.setQueryData<InboxResponse>(["inbox"], { visible: nextVisible });
      }

      const prevThingLists: Array<[readonly unknown[], Thing[] | undefined]> = [];
      for (const [key, data] of qc.getQueriesData<Thing[]>({ queryKey: ["things"] })) {
        if (!data) continue;
        prevThingLists.push([key, data]);
        qc.setQueryData<Thing[]>(
          key,
          data.map((t) => (idSet.has(t.id) ? { ...t, ...thingPatch } : t)),
        );
      }

      const prevDetails: Array<[string, ThingDetail | undefined]> = [];
      for (const id of ids) {
        const prev = qc.getQueryData<ThingDetail>(["thing-detail", id]);
        if (prev) {
          prevDetails.push([id, prev]);
          qc.setQueryData<ThingDetail>(["thing-detail", id], { ...prev, ...thingPatch });
        }
      }

      return { prevInbox, prevThingLists, prevDetails };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prevInbox !== undefined) {
        qc.setQueryData<InboxResponse>(["inbox"], ctx.prevInbox);
      }
      if (ctx?.prevThingLists) {
        for (const [key, data] of ctx.prevThingLists) {
          qc.setQueryData(key, data);
        }
      }
      if (ctx?.prevDetails) {
        for (const [id, data] of ctx.prevDetails) {
          qc.setQueryData(["thing-detail", id], data);
        }
      }
    },
    onSettled: () => {
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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["inbox"] });
      await qc.cancelQueries({ queryKey: ["things"] });

      const prevInbox = qc.getQueryData<InboxResponse>(["inbox"]);
      if (prevInbox) {
        qc.setQueryData<InboxResponse>(["inbox"], {
          visible: prevInbox.visible.filter((t) => t.id !== id),
        });
      }

      const prevThingLists: Array<[readonly unknown[], Thing[] | undefined]> = [];
      for (const [key, data] of qc.getQueriesData<Thing[]>({ queryKey: ["things"] })) {
        if (!data) continue;
        prevThingLists.push([key, data]);
        qc.setQueryData<Thing[]>(key, data.filter((t) => t.id !== id));
      }

      return { prevInbox, prevThingLists };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevInbox !== undefined) {
        qc.setQueryData<InboxResponse>(["inbox"], ctx.prevInbox);
      }
      if (ctx?.prevThingLists) {
        for (const [key, data] of ctx.prevThingLists) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: (_data, _err, id) => {
      invalidateAllThings(qc);
      qc.removeQueries({ queryKey: ["thing-detail", id] });
    },
  });
}
