import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { Attachment } from "@brett/types";

export function useUploadAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, file }: { itemId: string; file: File }) => {
      const buffer = await file.arrayBuffer();
      return apiFetch<Attachment>(`/things/${itemId}/attachments`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": file.name,
        },
        body: buffer,
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
    onSuccess: (_, { itemId }) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
  });
}
