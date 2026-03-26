import { useState, useCallback, useRef, useMemo } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { streamingFetch } from "./streaming";
import type { StreamChunk, DisplayHint } from "@brett/types";

// ─── Types ───

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  toolCalls?: Array<{
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    displayHint?: DisplayHint;
  }>;
}

interface ChatHistoryResponse {
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }>;
  hasMore: boolean;
  cursor: string | null;
  totalCount: number;
}

// ─── Hook ───

export function useBrettChat(opts: {
  itemId?: string | null;
  calendarEventId?: string | null;
}) {
  const { itemId, calendarEventId } = opts;
  const qc = useQueryClient();

  const [streamingMessages, setStreamingMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Determine paths
  const entityId = itemId || calendarEventId;
  const historyPath = itemId
    ? `/brett/chat/${itemId}`
    : calendarEventId
      ? `/brett/chat/event/${calendarEventId}`
      : null;
  const postPath = historyPath;

  // ─── Paginated history query ───

  const historyQuery = useInfiniteQuery({
    queryKey: ["brett-chat", entityId],
    queryFn: ({ pageParam }) => {
      const url = pageParam
        ? `${historyPath}?cursor=${encodeURIComponent(pageParam)}`
        : historyPath!;
      return apiFetch<ChatHistoryResponse>(url);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: !!entityId,
  });

  // Flatten history (newest first from API)
  const historyMessages: ChatMessage[] = useMemo(
    () =>
      historyQuery.data?.pages.flatMap((p) =>
        p.messages.map((m) => ({
          id: m.id,
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: m.content,
          createdAt: m.createdAt,
        })),
      ) ?? [],
    [historyQuery.data],
  );

  const totalCount = historyQuery.data?.pages[0]?.totalCount ?? 0;

  // Combine: history (newest first) + streaming messages
  // streamingMessages are appended in send order (oldest to newest within streaming batch)
  // We keep them separate: history is newest-first, streaming is in append order
  // The component (BrettThread) reverses history for display; streaming messages go at the end
  const messages = useMemo(() => {
    if (streamingMessages.length === 0) return historyMessages;
    return [...historyMessages, ...streamingMessages];
  }, [historyMessages, streamingMessages]);

  // ─── Send message ───

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming || !postPath) return;

      // Add user message optimistically
      const userMsg: ChatMessage = {
        id: `temp-user-${Date.now()}`,
        role: "user",
        content: trimmed,
        createdAt: new Date().toISOString(),
      };

      // Add placeholder assistant message
      const assistantMsg: ChatMessage = {
        id: `temp-assistant-${Date.now()}`,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
        toolCalls: [],
      };

      setStreamingMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const body: Record<string, unknown> = { message: trimmed };
        if (sessionId) body.sessionId = sessionId;

        for await (const chunk of streamingFetch(
          postPath,
          body,
          controller.signal,
        )) {
          if (controller.signal.aborted) break;

          switch (chunk.type) {
            case "text":
              setStreamingMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content + chunk.content,
                  };
                }
                return updated;
              });
              break;

            case "tool_call":
              setStreamingMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    toolCalls: [
                      ...(last.toolCalls ?? []),
                      { toolCallId: chunk.id, name: chunk.name, args: chunk.args, result: null },
                    ],
                  };
                }
                return updated;
              });
              break;

            case "tool_result":
              setStreamingMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === "assistant" && last.toolCalls) {
                  const toolCalls = last.toolCalls.map((tc) =>
                    tc.toolCallId === chunk.id
                      ? { ...tc, result: chunk.data, displayHint: chunk.displayHint }
                      : tc,
                  );
                  updated[updated.length - 1] = { ...last, toolCalls };
                }
                return updated;
              });
              // Invalidate data queries when a skill modifies data
              if (chunk.displayHint?.type === "task_created" || chunk.displayHint?.type === "confirmation") {
                qc.invalidateQueries({ queryKey: ["things"] });
                qc.invalidateQueries({ queryKey: ["inbox"] });
                qc.invalidateQueries({ queryKey: ["lists"] });
              }
              break;

            case "done":
              if (chunk.sessionId) {
                setSessionId(chunk.sessionId);
              }
              break;

            case "error":
              setStreamingMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content || `Error: ${chunk.message}`,
                  };
                }
                return updated;
              });
              break;
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setStreamingMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = {
                ...last,
                content:
                  last.content || "Something went wrong. Please try again.",
              };
            }
            return updated;
          });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        // Invalidate to pick up the persisted messages from server
        if (entityId) {
          qc.invalidateQueries({ queryKey: ["brett-chat", entityId] });
        }
      }
    },
    [isStreaming, postPath, sessionId, entityId, qc],
  );

  // Reset streaming messages when history refreshes (after invalidation)
  // We clear streaming messages once the server data includes them
  const clearStreamingMessages = useCallback(() => {
    setStreamingMessages([]);
  }, []);

  // When history query refetches successfully, clear streaming messages
  // This is triggered by the invalidation in sendMessage's finally block
  // We use a ref to track if we should clear
  const prevFetchStatus = useRef(historyQuery.fetchStatus);
  if (
    prevFetchStatus.current === "fetching" &&
    historyQuery.fetchStatus === "idle" &&
    streamingMessages.length > 0
  ) {
    clearStreamingMessages();
  }
  prevFetchStatus.current = historyQuery.fetchStatus;

  return {
    messages,
    totalCount: totalCount + streamingMessages.length,
    isStreaming,
    isLoading: historyQuery.isLoading,
    hasMore: historyQuery.hasNextPage ?? false,
    isLoadingMore: historyQuery.isFetchingNextPage,
    loadMore: historyQuery.fetchNextPage,
    sendMessage,
  };
}
