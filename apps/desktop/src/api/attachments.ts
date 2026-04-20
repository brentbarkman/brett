import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { Attachment, ThingDetail } from "@brett/types";

export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, file }: { itemId: string; file: File }) => {
      const buffer = await file.arrayBuffer();
      // Use Blob to ensure fetch sets Content-Length correctly
      const blob = new Blob([buffer], { type: file.type || "application/octet-stream" });
      return apiFetch<Attachment>(`/things/${itemId}/attachments`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": encodeURIComponent(file.name),
        },
        body: blob,
      });
    },
    onSuccess: (_, { itemId }) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
    onError: (err) => {
      console.error("Attachment upload failed:", err);
    },
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      attachmentId,
    }: {
      itemId: string;
      attachmentId: string;
    }) =>
      apiFetch(`/things/${itemId}/attachments/${attachmentId}`, {
        method: "DELETE",
      }),
    onMutate: async ({ itemId, attachmentId }) => {
      await qc.cancelQueries({ queryKey: ["thing-detail", itemId] });
      const prev = qc.getQueryData<ThingDetail>(["thing-detail", itemId]);
      if (prev) {
        qc.setQueryData<ThingDetail>(["thing-detail", itemId], {
          ...prev,
          attachments: prev.attachments.filter((a) => a.id !== attachmentId),
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
