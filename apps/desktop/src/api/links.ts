import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { ItemLink, ThingDetail } from "@brett/types";

export function useCreateLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      toItemId,
      toItemType,
    }: {
      itemId: string;
      toItemId: string;
      toItemType: string;
    }) =>
      apiFetch<ItemLink>(`/things/${itemId}/links`, {
        method: "POST",
        body: JSON.stringify({ toItemId, toItemType }),
      }),
    onMutate: async ({ itemId, toItemId, toItemType }) => {
      await qc.cancelQueries({ queryKey: ["thing-detail", itemId] });
      const prev = qc.getQueryData<ThingDetail>(["thing-detail", itemId]);
      if (prev) {
        const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const provisional: ItemLink = {
          id: tempId,
          toItemId,
          toItemType,
          source: "manual",
          createdAt: new Date().toISOString(),
        };
        qc.setQueryData<ThingDetail>(["thing-detail", itemId], {
          ...prev,
          links: [...prev.links, provisional],
        });
      }
      return { prev };
    },
    onError: (_err, { itemId }, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData<ThingDetail>(["thing-detail", itemId], ctx.prev);
      }
    },
    onSettled: (_data, _err, { itemId }) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
  });
}

export function useDeleteLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      linkId,
    }: {
      itemId: string;
      linkId: string;
    }) =>
      apiFetch(`/things/${itemId}/links/${linkId}`, { method: "DELETE" }),
    onMutate: async ({ itemId, linkId }) => {
      await qc.cancelQueries({ queryKey: ["thing-detail", itemId] });
      const prev = qc.getQueryData<ThingDetail>(["thing-detail", itemId]);
      if (prev) {
        qc.setQueryData<ThingDetail>(["thing-detail", itemId], {
          ...prev,
          links: prev.links.filter((l) => l.id !== linkId),
        });
      }
      return { prev };
    },
    onError: (_err, { itemId }, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData<ThingDetail>(["thing-detail", itemId], ctx.prev);
      }
    },
    onSettled: (_data, _err, { itemId }) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
  });
}
