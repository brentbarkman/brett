import { useState, useRef } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { streamingFetch } from "./streaming";
import type { StreamChunk, DisplayHint } from "@brett/types";
import { useAIConfigs } from "./ai-config";

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

  // Check if user has an active AI provider configured
  const { data: aiConfigData } = useAIConfigs();
  const aiConfigured = aiConfigData
    ? aiConfigData.configs.some((c) => c.isActive && c.isValid)
    : true; // Default true to avoid flash before data loads

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
  const historyMessages: ChatMessage[] =
    historyQuery.data?.pages.flatMap((p) =>
      p.messages.map((m) => ({
        id: m.id,
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.content,
        createdAt: m.createdAt,
      })),
    ) ?? [];

  const totalCount = historyQuery.data?.pages[0]?.totalCount ?? 0;

  // Combine: history (newest first from API) + streaming messages (in send order).
  // Streaming messages are prepended to the newest-first list so that when
  // BrettThread reverses the array, they appear at the bottom (most recent).
  // Deduplicate by filtering out history messages that match streaming temp IDs
  // or have the same content+role (for the brief window after server persists but
  // before streamingMessages are cleared).
  const messages = (() => {
    if (streamingMessages.length === 0) return historyMessages;
    // Streaming messages go at the START of the newest-first array
    // (they're the newest messages), in reverse send order to match newest-first
    const streamReversed = [...streamingMessages].reverse();
    // Deduplicate: if history already contains a message matching streaming content,
    // skip the history copy (server persisted it but we haven't cleared streaming yet)
    const streamingContents = new Set(
      streamingMessages.map((m) => `${m.role}:${m.content}`),
    );
    const dedupedHistory = historyMessages.filter(
      (m) => !streamingContents.has(`${m.role}:${m.content}`),
    );
    return [...streamReversed, ...dedupedHistory];
  })();

  // ─── Send message ───

  const sendMessage = async (text: string) => {
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
              // Invalidate + refetch data queries when a skill modifies data.
              // Both calls are needed: invalidate marks stale, refetch forces immediate update.
              if (chunk.displayHint?.type === "task_created" || chunk.displayHint?.type === "confirmation") {
                qc.invalidateQueries({ queryKey: ["things"] });
                qc.refetchQueries({ queryKey: ["things"] });
                qc.invalidateQueries({ queryKey: ["thing-detail"] });
                qc.refetchQueries({ queryKey: ["thing-detail"] });
                qc.invalidateQueries({ queryKey: ["inbox"] });
                qc.refetchQueries({ queryKey: ["inbox"] });
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
                    content: last.content || "Something went wrong. Please try again.",
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
  };

  // Reset streaming messages when history refreshes (after invalidation)
  // We clear streaming messages once the server data includes them
  const clearStreamingMessages = () => {
    setStreamingMessages([]);
  };

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
    aiConfigured,
  };
}
