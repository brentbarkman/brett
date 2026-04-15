import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { streamingFetch } from "./streaming";
import { useAIConfigs } from "./ai-config";
import { apiFetch } from "./client";
import type { StreamChunk, DisplayHint } from "@brett/types";

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

export interface SearchResult {
  entityType: string;
  entityId: string;
  title: string;
  snippet: string;
  score: number;
  matchType: "keyword" | "semantic" | "both";
  metadata: Record<string, unknown>;
}

export type OmnibarMode = "bar" | "spotlight";

export function useOmnibar() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<OmnibarMode>("bar");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<OmnibarMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Local action: search things directly (no AI needed)
  // Shows results as a one-shot display, not a conversation
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const pendingTextRef = useRef<string>("");
  const pendingFrameRef = useRef<number | null>(null);
  // Maps tool call id → name so we can look up the name when the result arrives
  const toolCallNamesRef = useRef<Map<string, string>>(new Map());
  const queryClient = useQueryClient();

  // Check if AI is configured
  const { data: aiConfigData } = useAIConfigs();
  const hasAI = (aiConfigData?.configs ?? []).some((c) => c.isActive && c.isValid);

  // ────────────────────────────────────────────────────────────────────
  // STABILITY CONTRACT
  //
  // Consumers depend on the returned object being stable when state hasn't
  // changed (e.g. App.tsx lists `omnibar` as an effect dep). The React
  // Compiler bails on this hook because of the large async `send` closure
  // (~150 lines, multiple try/catch, switch, ref mutation), so we have to
  // memoize manually.
  //
  // Pattern: capture all mutable state in a single ref that's updated on
  // every render. Each public function reads from `stateRef.current` so its
  // identity doesn't depend on individual state values — useCallback can
  // use empty deps (or just queryClient, which is stable). The final
  // `return useMemo(...)` then changes identity only when state observed
  // by consumers actually changes.
  // ────────────────────────────────────────────────────────────────────
  const stateRef = useRef({ isStreaming, messages, sessionId });
  stateRef.current = { isStreaming, messages, sessionId };

  // Deps: empty. Reads only from refs (pendingTextRef, pendingFrameRef) and
  // setMessages (React-stable). If you add reactive state reads here, you
  // must also propagate them through scheduleFlush and send's dep array —
  // prefer the stateRef pattern instead to keep this callback stable.
  const flushPendingText = useCallback(() => {
    if (pendingFrameRef.current !== null) {
      cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    }
    const buffered = pendingTextRef.current;
    if (!buffered) return;
    pendingTextRef.current = "";
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last && last.role === "assistant") {
        updated[updated.length - 1] = {
          ...last,
          content: last.content + buffered,
        };
      }
      return updated;
    });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (pendingFrameRef.current !== null) return;
    pendingFrameRef.current = requestAnimationFrame(() => {
      pendingFrameRef.current = null;
      flushPendingText();
    });
  }, [flushPendingText]);

  // Cancel any pending rAF on unmount so a late-firing flush doesn't hit
  // setMessages on a dead component.
  useEffect(() => {
    return () => {
      if (pendingFrameRef.current !== null) {
        cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
    };
  }, []);

  const send = useCallback(async (text: string, currentView?: string, intent?: string) => {
      const trimmed = text.trim();
      if (!trimmed || stateRef.current.isStreaming) return;

      // Starting a send implies the user wants the omnibar visible so they
      // can see the response. Ensure the surface is open and not minimized —
      // protects against the "Enter pressed while omnibar is closing" race
      // and against orphaned post-Spotlight-dismiss sends.
      setIsOpen(true);
      setIsMinimized(false);

      // Add user message
      const userMsg: OmnibarMessage = { role: "user", content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsStreaming(true);

      // Add placeholder assistant message
      setMessages((prev) => [...prev, { role: "assistant", content: "", toolCalls: [] }]);

      const controller = new AbortController();
      abortRef.current = controller;

      const pendingInvalidations = new Set<string>();

      try {
        const body: Record<string, unknown> = { message: trimmed };
        const currentSessionId = stateRef.current.sessionId;
        if (currentSessionId) body.sessionId = currentSessionId;
        const ctx: Record<string, unknown> = {};
        if (currentView) ctx.currentView = currentView;
        if (intent) ctx.intent = intent;
        if (Object.keys(ctx).length > 0) body.context = ctx;
        // Send recent messages so server has context even if DB persist hasn't completed.
        // For assistant messages, include tool result messages alongside text content
        // so the LLM has full context about what was found/discussed.
        const currentMessages = stateRef.current.messages;
        if (currentMessages.length > 0) {
          body.recentMessages = currentMessages
            .filter((m) => m.content || m.toolCalls?.some((tc) => tc.result))
            .slice(-10)
            .map((m) => {
              if (m.role === "assistant") {
                // Combine text content with tool result messages
                const toolResultText = (m.toolCalls ?? [])
                  .filter((tc) => tc.result && typeof tc.result === "object" && tc.result !== null)
                  .map((tc) => {
                    const r = tc.result as Record<string, unknown>;
                    return typeof r.message === "string" ? r.message : "";
                  })
                  .filter(Boolean)
                  .join("\n");
                const fullContent = [toolResultText, m.content].filter(Boolean).join("\n");
                return { role: "assistant" as const, content: fullContent };
              }
              return { role: "user" as const, content: m.content };
            })
            .filter((m) => m.content);
        }

        for await (const chunk of streamingFetch(
          "/brett/omnibar",
          body,
          controller.signal
        )) {
          if (controller.signal.aborted) break;

          switch (chunk.type) {
            case "text":
              pendingTextRef.current += chunk.content;
              scheduleFlush();
              break;

            case "tool_call":
              flushPendingText();
              // Record the tool name so we can look it up when the result arrives
              toolCallNamesRef.current.set(chunk.id, chunk.name);
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
              flushPendingText();
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
              // Cache invalidation paths for tool_result:
              //   1. Confirmation displayHints → immediate invalidate (user sees a card)
              //   2. Scout mutations → deferred to stream end (no visible card mid-stream)
              //   3. Read-only tools (search, list, etc.) → no invalidation needed
              // If a new mutation skill is added, it MUST emit a confirmation
              // displayHint (path 1) or be added to the scout-adjacent deferred
              // set (path 2). Silence = no cache update for active observers.
              // Confirmation-style results: invalidate immediately so the
              // user-visible card reflects fresh backing data. invalidateQueries
              // marks the query stale and triggers a background refetch if there
              // is an active observer (any mounted component that subscribes to
              // this key). This is the normal case while the omnibar is open.
              // If a relevant list view is not mounted at this moment, the
              // refetch is deferred until next mount — acceptable tradeoff.
              if (chunk.displayHint?.type === "task_created" || chunk.displayHint?.type === "confirmation") {
                queryClient.invalidateQueries({ queryKey: ["things"] });
                queryClient.invalidateQueries({ queryKey: ["thing-detail"] });
                queryClient.invalidateQueries({ queryKey: ["inbox"] });
                queryClient.invalidateQueries({ queryKey: ["lists"] });
              }
              // Scout mutations: defer to stream end. No visible card, so
              // batching until the stream completes is user-invisible.
              {
                // Scout mutations go through AI tools: create_scout, update_scout.
                // Deletion is not an AI tool — it uses useDeleteScout directly.
                const toolName = toolCallNamesRef.current.get(chunk.id);
                if (toolName === "create_scout" || toolName === "update_scout") {
                  pendingInvalidations.add("scouts");
                }
              }
              break;

            case "done":
              flushPendingText();
              if (chunk.sessionId) {
                setSessionId(chunk.sessionId);
              }
              break;

            case "error":
              flushPendingText();
              console.error("[omnibar] SSE error event:", chunk);
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
              break;
          }
        }
      } catch (err) {
        flushPendingText(); // drain buffered text before appending error message
        console.error("[omnibar] Stream exception:", err);
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
        flushPendingText(); // idempotent safety net — no-op if catch already drained
        for (const key of pendingInvalidations) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
        setIsStreaming(false);
        abortRef.current = null;
      }
  }, [queryClient, scheduleFlush, flushPendingText]);

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
    setIsMinimized(false);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setMessages([]);
    setSessionId(null);
    setInput("");
    setSearchResults(null);
    setIsMinimized(false);
    toolCallNamesRef.current.clear();
  }, [cancel]);

  const minimize = useCallback(() => {
    if (stateRef.current.isStreaming) return; // don't minimize mid-stream
    setIsMinimized(true);
  }, []);

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

  const searchThings = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setInput("");
    setIsSearching(true);
    setSearchResults(null);

    try {
      const resp = await apiFetch<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(trimmed)}`);
      setSearchResults(resp.results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Actions — stable identity across streaming state changes. Consumer effects
  // that only depend on actions (e.g. keyboard shortcut setup in App.tsx) won't
  // re-run per SSE chunk.
  const actions = useMemo(() => ({
    open,
    close,
    cancel,
    reset,
    setInput,
    send,
    createTask,
    searchThings,
    minimize,
    // setInput omitted from deps below — useState setter, identity is guaranteed stable by React
  }), [open, close, cancel, reset, send, createTask, searchThings, minimize]);

  // State — changes per render; consumers that read these are expected to re-render
  const state = useMemo(() => ({
    isOpen,
    mode,
    input,
    messages,
    isStreaming,
    sessionId,
    hasAI,
    searchResults,
    isSearching,
    isMinimized,
  }), [
    isOpen,
    mode,
    input,
    messages,
    isStreaming,
    sessionId,
    hasAI,
    searchResults,
    isSearching,
    isMinimized,
  ]);

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
