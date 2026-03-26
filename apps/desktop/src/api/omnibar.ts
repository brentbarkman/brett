import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { streamingFetch } from "./streaming";
import { useAIConfigs } from "./ai-config";
import { apiFetch } from "./client";
import type { StreamChunk, DisplayHint, Thing } from "@brett/types";

export interface OmnibarMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    displayHint?: DisplayHint;
  }>;
}

export type OmnibarMode = "bar" | "spotlight";

export function useOmnibar() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<OmnibarMode>("bar");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<OmnibarMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  // Check if AI is configured
  const { data: aiConfigData } = useAIConfigs();
  const hasAI = (aiConfigData?.configs ?? []).some((c) => c.isActive && c.isValid);

  const send = useCallback(
    async (text: string, currentView?: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      // Add user message
      const userMsg: OmnibarMessage = { role: "user", content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsStreaming(true);

      // Add placeholder assistant message
      setMessages((prev) => [...prev, { role: "assistant", content: "", toolCalls: [] }]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const body: Record<string, unknown> = { message: trimmed };
        if (sessionId) body.sessionId = sessionId;
        if (currentView) body.context = { currentView };

        for await (const chunk of streamingFetch(
          "/brett/omnibar",
          body,
          controller.signal
        )) {
          if (controller.signal.aborted) break;

          switch (chunk.type) {
            case "text":
              setMessages((prev) => {
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
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === "assistant") {
                  updated[updated.length - 1] = {
                    ...last,
                    toolCalls: [
                      ...(last.toolCalls ?? []),
                      {
                        id: chunk.id,
                        name: chunk.name,
                        args: chunk.args,
                        result: null,
                      },
                    ],
                  };
                }
                return updated;
              });
              break;

            case "tool_result":
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === "assistant" && last.toolCalls) {
                  const toolCalls = last.toolCalls.map((tc) =>
                    tc.id === chunk.id
                      ? { ...tc, result: chunk.data, displayHint: chunk.displayHint }
                      : tc
                  );
                  updated[updated.length - 1] = { ...last, toolCalls };
                }
                return updated;
              });
              // Invalidate data queries when a skill modifies data so lists refresh
              if (chunk.displayHint?.type === "task_created" || chunk.displayHint?.type === "confirmation") {
                queryClient.invalidateQueries({ queryKey: ["things"] });
                queryClient.invalidateQueries({ queryKey: ["inbox"] });
                queryClient.invalidateQueries({ queryKey: ["lists"] });
              }
              break;

            case "done":
              if (chunk.sessionId) {
                setSessionId(chunk.sessionId);
              }
              break;

            case "error":
              setMessages((prev) => {
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
          setMessages((prev) => {
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
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, sessionId]
  );

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const close = useCallback(() => {
    cancel();
    setIsOpen(false);
    setSearchResults(null);
    // Keep input, messages, and sessionId so reopening restores state
  }, [cancel]);

  const open = useCallback((newMode: OmnibarMode = "bar") => {
    setMode(newMode);
    setIsOpen(true);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setMessages([]);
    setSessionId(null);
    setInput("");
    setSearchResults(null);
  }, [cancel]);

  // Local action: create a task directly (no AI needed)
  // No chat UI — just do it, invalidate queries, close the omnibar
  // When on Today view, set dueDate to today so it appears in the current list
  const createTask = useCallback(async (title: string, currentView?: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    setInput("");

    const body: Record<string, unknown> = { title: trimmed, type: "task" };

    // Context-aware defaults based on current view
    if (currentView === "today") {
      body.dueDate = new Date().toISOString().split("T")[0];
    } else if (currentView?.startsWith("list:")) {
      body.listId = currentView.slice(5);
    }

    try {
      await apiFetch("/things", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
      queryClient.invalidateQueries({ queryKey: ["things"] });
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
    } catch {
      // Silently fail — user will notice if the task doesn't appear
    }

    // Close omnibar — no conversation in non-AI mode
    setIsOpen(false);
    setMessages([]);
    setSessionId(null);
  }, [queryClient]);

  // Local action: search things directly (no AI needed)
  // Shows results as a one-shot display, not a conversation
  const [searchResults, setSearchResults] = useState<Thing[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const searchThings = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setInput("");
    setIsSearching(true);
    setSearchResults(null);

    try {
      const results = await apiFetch<Thing[]>(`/things?search=${encodeURIComponent(trimmed)}`);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  return {
    isOpen,
    mode,
    input,
    setInput,
    messages,
    isStreaming,
    sessionId,
    hasAI,
    send,
    createTask,
    searchThings,
    searchResults,
    isSearching,
    cancel,
    close,
    open,
    reset,
  };
}
