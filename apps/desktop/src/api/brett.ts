import { useState, useCallback, useEffect } from "react";
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

/** Fetches brett messages with manual "load more" pagination */
export function useBrettMessages(itemId: string | null) {
  const [allMessages, setAllMessages] = useState<BrettMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Initial fetch
  const query = useQuery({
    queryKey: ["brett-messages", itemId],
    queryFn: () => apiFetch<BrettMessagesResponse>(`/things/${itemId}/brett`),
    enabled: !!itemId,
  });

  // Sync initial data
  useEffect(() => {
    if (query.data) {
      setAllMessages(query.data.messages);
      setCursor(query.data.cursor);
      setHasMore(query.data.hasMore);
    }
  }, [query.data]);

  // Reset when item changes
  useEffect(() => {
    setAllMessages([]);
    setCursor(null);
    setHasMore(false);
  }, [itemId]);

  const loadMore = useCallback(async () => {
    if (!itemId || !cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await apiFetch<BrettMessagesResponse>(
        `/things/${itemId}/brett?cursor=${encodeURIComponent(cursor)}`
      );
      // API returns newest-first; append older messages to end
      setAllMessages((prev) => [...prev, ...res.messages]);
      setCursor(res.cursor);
      setHasMore(res.hasMore);
    } finally {
      setIsLoadingMore(false);
    }
  }, [itemId, cursor, isLoadingMore]);

  return {
    messages: allMessages,
    hasMore,
    isLoadingMore,
    loadMore,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
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
