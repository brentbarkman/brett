import { useMemo } from "react";
import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { BrettMessage } from "@brett/types";

interface BrettMessagesResponse {
  messages: BrettMessage[];
  hasMore: boolean;
  cursor: string | null;
  totalCount: number;
}

interface BrettSendResponse {
  userMessage: BrettMessage;
  brettMessage: BrettMessage;
}

export function useBrettMessages(itemId: string | null) {
  const query = useInfiniteQuery({
    queryKey: ["brett-messages", itemId],
    queryFn: ({ pageParam }) => {
      const url = pageParam
        ? `/things/${itemId}/brett?cursor=${encodeURIComponent(pageParam)}`
        : `/things/${itemId}/brett`;
      return apiFetch<BrettMessagesResponse>(url);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: !!itemId,
  });

  // Flatten all pages into a single message array (newest first from API)
  const messages = useMemo(
    () => query.data?.pages.flatMap((p) => p.messages) ?? [],
    [query.data],
  );

  // Total count from the most recent page (always up to date)
  const totalCount = query.data?.pages[0]?.totalCount ?? 0;

  return {
    messages,
    totalCount,
    hasMore: query.hasNextPage ?? false,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: query.fetchNextPage,
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
