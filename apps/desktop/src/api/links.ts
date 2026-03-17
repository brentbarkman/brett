import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { ItemLink } from "@brett/types";

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
    onSuccess: (_, { itemId }) => {
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
    onSuccess: (_, { itemId }) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
  });
}
