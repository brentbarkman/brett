import { useState, useCallback, useEffect, useRef } from "react";
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
  const [olderMessages, setOlderMessages] = useState<BrettMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [olderHasMore, setOlderHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const prevItemId = useRef(itemId);

  // Reset older pages when item changes
  useEffect(() => {
    if (itemId !== prevItemId.current) {
      setOlderMessages([]);
      setOlderCursor(null);
      setOlderHasMore(false);
      prevItemId.current = itemId;
    }
  }, [itemId]);

  // Initial page — React Query handles caching/refetching
  const query = useQuery({
    queryKey: ["brett-messages", itemId],
    queryFn: () => apiFetch<BrettMessagesResponse>(`/things/${itemId}/brett`),
    enabled: !!itemId,
  });

  // When initial data changes (refetch after send), reset older pages
  // because the initial page now has the newest messages
  const dataRef = useRef(query.data);
  useEffect(() => {
    if (query.data && query.data !== dataRef.current) {
      dataRef.current = query.data;
      // Only reset if we had older pages loaded
      if (olderMessages.length > 0) {
        setOlderMessages([]);
        setOlderCursor(null);
        setOlderHasMore(false);
      }
    }
  }, [query.data, olderMessages.length]);

  const firstPage = query.data;

  // Combine: first page (newest) + older pages
  const messages = firstPage
    ? [...firstPage.messages, ...olderMessages]
    : [];

  // hasMore: if we have older pages loaded, use that flag; otherwise use first page's
  const hasMore = olderMessages.length > 0
    ? olderHasMore
    : (firstPage?.hasMore ?? false);

  // Cursor for next load: use older cursor if we've loaded pages, otherwise first page cursor
  const nextCursor = olderMessages.length > 0
    ? olderCursor
    : (firstPage?.cursor ?? null);

  const loadMore = useCallback(async () => {
    if (!itemId || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await apiFetch<BrettMessagesResponse>(
        `/things/${itemId}/brett?cursor=${encodeURIComponent(nextCursor)}`
      );
      setOlderMessages((prev) => [...prev, ...res.messages]);
      setOlderCursor(res.cursor);
      setOlderHasMore(res.hasMore);
    } finally {
      setIsLoadingMore(false);
    }
  }, [itemId, nextCursor, isLoadingMore]);

  return {
    messages,
    hasMore,
    isLoadingMore,
    loadMore,
    isLoading: query.isLoading,
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
