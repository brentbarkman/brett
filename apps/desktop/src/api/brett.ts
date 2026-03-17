import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { BrettMessage } from "@brett/types";

interface BrettMessagesResponse {
  messages: BrettMessage[];
  hasMore: boolean;
  cursor: string | null;
}

interface BrettSendResponse {
  userMessage: BrettMessage;
  brettMessage: BrettMessage;
}

export function useBrettMessages(itemId: string | null) {
  return useQuery({
    queryKey: ["brett-messages", itemId],
    queryFn: () => apiFetch<BrettMessagesResponse>(`/things/${itemId}/brett`),
    enabled: !!itemId,
  });
}

export function useSendBrettMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, content }: { itemId: string; content: string }) =>
      apiFetch<BrettSendResponse>(`/things/${itemId}/brett`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }),
    onSuccess: (_, { itemId }) => {
      qc.invalidateQueries({ queryKey: ["brett-messages", itemId] });
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
    },
  });
}

export function useRefreshBrettTake() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch<{ brettObservation: string; brettTakeGeneratedAt: string }>(
        `/things/${itemId}/brett-take`,
        { method: "POST" },
      ),
    onSuccess: (_, itemId) => {
      qc.invalidateQueries({ queryKey: ["thing-detail", itemId] });
      qc.invalidateQueries({ queryKey: ["things"] });
    },
  });
}
