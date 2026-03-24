import { useState, useCallback, useRef } from "react";
import { streamingFetch } from "./streaming";
import { useAIConfigs } from "./ai-config";
import { apiFetch } from "./client";
import type { StreamChunk, DisplayHint, Thing } from "@brett/types";

export interface OmnibarMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
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
                    tc.name === findToolCallById(last.toolCalls!, chunk.id)?.name && tc.result === null
                      ? { ...tc, result: chunk.data, displayHint: chunk.displayHint }
                      : tc
                  );
                  updated[updated.length - 1] = { ...last, toolCalls };
                }
                return updated;
              });
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
    setInput("");
    // Keep messages and sessionId so reopening shows history
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
  }, [cancel]);

  // Local action: create a task directly (no AI needed)
  const createTask = useCallback(async (title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    setMessages((prev) => [...prev, { role: "user", content: `Create task: "${trimmed}"` }]);
    setInput("");

    try {
      const result = await apiFetch<{ id: string; title: string }>("/things", {
        method: "POST",
        body: JSON.stringify({ title: trimmed, type: "task" }),
        headers: { "Content-Type": "application/json" },
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Created task "${result.title}".`, toolCalls: [{ name: "create_task", args: { title: trimmed }, result, displayHint: { type: "task_created" as const, taskId: result.id } }] },
      ]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Failed to create task. Please try again." }]);
    }
  }, []);

  // Local action: search things directly (no AI needed)
  const searchThings = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setMessages((prev) => [...prev, { role: "user", content: `Search: "${trimmed}"` }]);
    setInput("");

    try {
      const results = await apiFetch<Thing[]>(`/things?search=${encodeURIComponent(trimmed)}`);
      if (results.length === 0) {
        setMessages((prev) => [...prev, { role: "assistant", content: `No results found for "${trimmed}".` }]);
      } else {
        const items = results.slice(0, 10).map((t) => ({ id: t.id, title: t.title, status: t.status }));
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Found ${results.length} item${results.length === 1 ? "" : "s"}:`, toolCalls: [{ name: "search_things", args: { query: trimmed }, result: items, displayHint: { type: "task_list" as const, items } }] },
        ]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Search failed. Please try again." }]);
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
    cancel,
    close,
    open,
    reset,
  };
}

// Helper to find a tool call matching a result id (tool_result chunks use the same id as tool_call)
function findToolCallById(
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: unknown }>,
  _id: string
) {
  // The tool_result id matches the tool_call id, but we store by name.
  // Since tool calls are processed in order, find the first one without a result.
  return toolCalls.find((tc) => tc.result === null) ?? null;
}
