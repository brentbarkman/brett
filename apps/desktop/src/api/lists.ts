import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { NavList } from "@brett/types";
import { apiFetch } from "./client";
import { invalidateAllThings } from "./invalidate";

export function useLists() {
  return useQuery({
    queryKey: ["lists"],
    queryFn: () => apiFetch<NavList[]>("/lists"),
  });
}

function provisionalList(input: { name: string; colorClass?: string }, tempId: string, sortOrder: number): NavList {
  return {
    id: tempId,
    name: input.name,
    count: 0,
    completedCount: 0,
    colorClass: input.colorClass ?? "white",
    sortOrder,
    archivedAt: null,
  };
}

export function useCreateList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; colorClass?: string }) =>
      apiFetch<NavList>("/lists", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["lists"] });
      const prev = qc.getQueryData<NavList[]>(["lists"]);
      const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const minSortOrder = prev?.length ? Math.min(...prev.map((l) => l.sortOrder)) : 0;
      const provisional = provisionalList(input, tempId, minSortOrder - 1);
      qc.setQueryData<NavList[]>(["lists"], prev ? [provisional, ...prev] : [provisional]);
      return { prev, tempId };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData<NavList[]>(["lists"], ctx.prev);
      }
    },
    onSuccess: (newList, _input, ctx) => {
      // Replace the temp entry with the real server record so child pages
      // (ListView navigated via slug) resolve to the correct id after the
      // cache refetch.
      if (ctx?.tempId) {
        qc.setQueryData<NavList[]>(["lists"], (old) =>
          old ? old.map((l) => (l.id === ctx.tempId ? newList : l)) : [newList],
        );
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useUpdateList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; colorClass?: string }) =>
      apiFetch<NavList>(`/lists/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: ["lists"] });
      const prev = qc.getQueryData<NavList[]>(["lists"]);
      if (prev) {
        qc.setQueryData<NavList[]>(
          ["lists"],
          prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        );
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData<NavList[]>(["lists"], ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useDeleteList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/lists/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["lists"] });
      const prev = qc.getQueryData<NavList[]>(["lists"]);
      const prevArchived = qc.getQueryData<NavList[]>(["lists", "archived"]);
      if (prev) qc.setQueryData<NavList[]>(["lists"], prev.filter((l) => l.id !== id));
      if (prevArchived) qc.setQueryData<NavList[]>(["lists", "archived"], prevArchived.filter((l) => l.id !== id));
      return { prev, prevArchived };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData<NavList[]>(["lists"], ctx.prev);
      if (ctx?.prevArchived !== undefined) qc.setQueryData<NavList[]>(["lists", "archived"], ctx.prevArchived);
    },
    onSettled: () => {
      invalidateAllThings(qc);
    },
  });
}

export function useReorderLists() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ ok: boolean }>("/lists/reorder", {
        method: "PUT",
        body: JSON.stringify({ ids }),
      }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ["lists"] });
      const previous = qc.getQueryData<NavList[]>(["lists"]);

      if (previous) {
        const reordered = ids
          .map((id, index) => {
            const list = previous.find((l) => l.id === id);
            return list ? { ...list, sortOrder: index } : null;
          })
          .filter((l): l is NavList => l !== null);
        qc.setQueryData(["lists"], reordered);
      }

      return { previous };
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) {
        qc.setQueryData(["lists"], context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useArchiveList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ archivedAt: string; itemsCompleted: number }>(`/lists/${id}/archive`, {
        method: "PATCH",
      }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["lists"] });
      const prev = qc.getQueryData<NavList[]>(["lists"]);
      const prevArchived = qc.getQueryData<NavList[]>(["lists", "archived"]);

      const archivingList = prev?.find((l) => l.id === id);
      if (prev) qc.setQueryData<NavList[]>(["lists"], prev.filter((l) => l.id !== id));
      if (archivingList && prevArchived !== undefined) {
        const archivedEntry = { ...archivingList, archivedAt: new Date().toISOString() };
        qc.setQueryData<NavList[]>(["lists", "archived"], [archivedEntry, ...prevArchived]);
      }
      return { prev, prevArchived };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData<NavList[]>(["lists"], ctx.prev);
      if (ctx?.prevArchived !== undefined) qc.setQueryData<NavList[]>(["lists", "archived"], ctx.prevArchived);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      qc.invalidateQueries({ queryKey: ["things"] });
    },
  });
}

export function useUnarchiveList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<NavList>(`/lists/${id}/unarchive`, {
        method: "PATCH",
      }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["lists"] });
      const prev = qc.getQueryData<NavList[]>(["lists"]);
      const prevArchived = qc.getQueryData<NavList[]>(["lists", "archived"]);

      const unarchivingList = prevArchived?.find((l) => l.id === id);
      if (prevArchived) {
        qc.setQueryData<NavList[]>(["lists", "archived"], prevArchived.filter((l) => l.id !== id));
      }
      if (unarchivingList && prev !== undefined) {
        const restored = { ...unarchivingList, archivedAt: null };
        qc.setQueryData<NavList[]>(["lists"], [...prev, restored]);
      }
      return { prev, prevArchived };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData<NavList[]>(["lists"], ctx.prev);
      if (ctx?.prevArchived !== undefined) qc.setQueryData<NavList[]>(["lists", "archived"], ctx.prevArchived);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useArchivedLists() {
  return useQuery({
    queryKey: ["lists", "archived"],
    queryFn: () => apiFetch<NavList[]>("/lists?archived=true"),
  });
}
