import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { NavList } from "@brett/types";
import { apiFetch } from "./client";

export function useLists() {
  return useQuery({
    queryKey: ["lists"],
    queryFn: () => apiFetch<NavList[]>("/lists"),
  });
}

export function useCreateList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; colorClass?: string }) =>
      apiFetch<NavList>("/lists", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useDeleteList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/lists/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
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
    onSuccess: () => {
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
    onSuccess: () => {
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
