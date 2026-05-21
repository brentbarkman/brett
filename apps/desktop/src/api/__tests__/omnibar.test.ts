import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useOmnibar } from "../omnibar";

// Mock dependencies
vi.mock("../client", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("../streaming", () => ({
  streamingFetch: vi.fn(),
}));

vi.mock("../ai-config", () => ({
  useAIConfigs: vi.fn(() => ({ data: null })),
}));

import { apiFetch } from "../client";
import { useAIConfigs } from "../ai-config";

const mockApiFetch = vi.mocked(apiFetch);
const mockUseAIConfigs = vi.mocked(useAIConfigs);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useOmnibar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAIConfigs.mockReturnValue({ data: null } as any);
  });

  describe("hasAI", () => {
    it("is false when no AI configs", () => {
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });
      expect(result.current.hasAI).toBe(false);
    });

    it("is true when active valid config exists", () => {
      mockUseAIConfigs.mockReturnValue({
        data: { configs: [{ isActive: true, isValid: true, provider: "anthropic" }] },
      } as any);
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });
      expect(result.current.hasAI).toBe(true);
    });

    it("is false when config exists but is invalid", () => {
      mockUseAIConfigs.mockReturnValue({
        data: { configs: [{ isActive: true, isValid: false, provider: "anthropic" }] },
      } as any);
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });
      expect(result.current.hasAI).toBe(false);
    });
  });

  describe("createTask", () => {
    // Helper: read the POST /things body from the latest apiFetch call.
    const lastCreateBody = () => {
      const call = mockApiFetch.mock.calls.find((c) => c[0] === "/things");
      if (!call) throw new Error("apiFetch was not called with /things");
      return JSON.parse(call[1]!.body as string);
    };

    it("posts a task with the trimmed title and type=task", async () => {
      mockApiFetch.mockResolvedValue({ id: "123", title: "Buy groceries" });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.createTask("Buy groceries");
      });

      const path = mockApiFetch.mock.calls[0][0];
      const init = mockApiFetch.mock.calls[0][1]!;
      expect(path).toBe("/things");
      expect(init.method).toBe("POST");
      const body = lastCreateBody();
      expect(body.type).toBe("task");
      expect(body.title).toBe("Buy groceries");
    });

    it("sets dueDate to today (UTC midnight) when on today view", async () => {
      mockApiFetch.mockResolvedValue({ id: "123", title: "Test" });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.createTask("Test task", "today");
      });

      const body = lastCreateBody();
      // ISO timestamp at the start of today (UTC). Asserts the value lands in
      // the same UTC day rather than pinning the exact string format.
      expect(body.dueDate).toBeTruthy();
      const due = new Date(body.dueDate);
      const todayUtc = new Date();
      todayUtc.setUTCHours(0, 0, 0, 0);
      expect(due.getUTCFullYear()).toBe(todayUtc.getUTCFullYear());
      expect(due.getUTCMonth()).toBe(todayUtc.getUTCMonth());
      expect(due.getUTCDate()).toBe(todayUtc.getUTCDate());
      expect(body.dueDatePrecision).toBe("day");
    });

    it("sets listId when on a list view", async () => {
      mockApiFetch.mockResolvedValue({ id: "123", title: "Test" });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.createTask("Test task", "list:abc123def456");
      });

      expect(lastCreateBody().listId).toBe("abc123def456");
    });

    it("sets no dueDate or listId for other views", async () => {
      mockApiFetch.mockResolvedValue({ id: "123", title: "Test" });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.createTask("Test task", "inbox");
      });

      const body = lastCreateBody();
      expect(body.dueDate).toBeUndefined();
      expect(body.listId).toBeUndefined();
    });

    it("closes omnibar after creating task", async () => {
      mockApiFetch.mockResolvedValue({ id: "123", title: "Test" });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      act(() => result.current.open("bar"));
      expect(result.current.isOpen).toBe(true);

      await act(async () => {
        await result.current.createTask("Test task");
      });

      expect(result.current.isOpen).toBe(false);
      expect(result.current.messages).toHaveLength(0);
    });

    it("does nothing for empty/whitespace title", async () => {
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.createTask("   ");
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
    });

    it("clears input after creating task", async () => {
      mockApiFetch.mockResolvedValue({ id: "123", title: "Test" });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      act(() => result.current.setInput("Buy groceries"));
      expect(result.current.input).toBe("Buy groceries");

      await act(async () => {
        await result.current.createTask("Buy groceries");
      });

      expect(result.current.input).toBe("");
    });

    // Guards the #182 fix: the cache write happens before the server replies.
    // Without optimistic updates, the user would see lag waiting for the
    // network round-trip plus refetch.
    it("inserts into the cache optimistically before the server responds", async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children);

      // Server hangs — proves the cache write is independent of the network.
      let resolveServer: (v: unknown) => void = () => {};
      mockApiFetch.mockImplementation(
        () => new Promise((resolve) => { resolveServer = resolve; }),
      );

      queryClient.setQueryData(["inbox"], { visible: [] });

      const { result } = renderHook(() => useOmnibar(), { wrapper });

      act(() => {
        result.current.createTask("Fresh task");
      });

      await waitFor(() => {
        const inbox = queryClient.getQueryData<{ visible: { title: string }[] }>(["inbox"]);
        expect(inbox?.visible).toHaveLength(1);
        expect(inbox?.visible[0]?.title).toBe("Fresh task");
      });

      resolveServer({ id: "server-id", title: "Fresh task" });
    });
  });

  describe("searchThings", () => {
    it("calls API with search query", async () => {
      mockApiFetch.mockResolvedValue({ results: [{ id: "1", title: "NVDA Research", status: "active" }] });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.searchThings("NVDA");
      });

      expect(mockApiFetch).toHaveBeenCalledWith("/api/search?q=NVDA");
    });

    it("sets searchResults with API response", async () => {
      const items = [{ id: "1", title: "NVDA Research", status: "active", type: "task" }];
      mockApiFetch.mockResolvedValue({ results: items });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.searchThings("NVDA");
      });

      expect(result.current.searchResults).toEqual(items);
      expect(result.current.isSearching).toBe(false);
    });

    it("sets empty array on API error", async () => {
      mockApiFetch.mockRejectedValue(new Error("Network error"));
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.searchThings("test");
      });

      expect(result.current.searchResults).toEqual([]);
    });

    it("does nothing for empty query", async () => {
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.searchThings("  ");
      });

      expect(mockApiFetch).not.toHaveBeenCalled();
    });

    it("encodes special characters in search query", async () => {
      mockApiFetch.mockResolvedValue([]);
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.searchThings("test & query");
      });

      expect(mockApiFetch).toHaveBeenCalledWith("/api/search?q=test%20%26%20query");
    });

    it("does not enter conversation mode", async () => {
      mockApiFetch.mockResolvedValue([{ id: "1", title: "Test", status: "active" }]);
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.searchThings("test");
      });

      // Search should NOT add messages (no conversation UI in non-AI mode)
      expect(result.current.messages).toHaveLength(0);
    });
  });

  describe("minimize", () => {
    it("sets isMinimized without clearing messages", async () => {
      const { streamingFetch } = await import("../streaming");
      const mockStream = vi.mocked(streamingFetch);
      mockStream.mockImplementation(async function* () {
        yield { type: "text" as const, content: "hello" };
        yield { type: "done" as const, sessionId: "s1", usage: { input: 1, output: 1 } };
      });

      mockUseAIConfigs.mockReturnValue({
        data: { configs: [{ isActive: true, isValid: true, provider: "anthropic" }] },
      } as any);

      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.send("hi");
      });

      expect(result.current.messages.length).toBeGreaterThan(0);
      const messagesBefore = result.current.messages;

      act(() => {
        result.current.minimize();
      });

      expect(result.current.isMinimized).toBe(true);
      expect(result.current.messages).toBe(messagesBefore); // identity unchanged
    });

    it("open() clears isMinimized", () => {
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      act(() => {
        result.current.minimize();
      });
      expect(result.current.isMinimized).toBe(true);

      act(() => {
        result.current.open("bar");
      });
      expect(result.current.isMinimized).toBe(false);
    });

    it("reset() clears isMinimized", () => {
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      act(() => {
        result.current.minimize();
      });

      act(() => {
        result.current.reset();
      });
      expect(result.current.isMinimized).toBe(false);
    });

    it("is a no-op while streaming", async () => {
      const { streamingFetch } = await import("../streaming");
      const mockStream = vi.mocked(streamingFetch);
      // Infinite generator — send() stays in-flight (isStreaming === true) throughout
      mockStream.mockImplementation(async function* () {
        yield { type: "text" as const, content: "still streaming..." };
        // Never yield "done" — simulate a stream in progress
        await new Promise<void>(() => {}); // hang indefinitely
      });

      mockUseAIConfigs.mockReturnValue({
        data: { configs: [{ isActive: true, isValid: true, provider: "anthropic" }] },
      } as any);

      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      // Kick off send() without awaiting — it'll hang on the infinite generator.
      act(() => {
        void result.current.send("hi");
      });

      // Let the text chunk settle and isStreaming flip to true
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
      });

      // Now try to minimize — should be a no-op
      act(() => {
        result.current.minimize();
      });

      expect(result.current.isMinimized).toBe(false);

      // Clean up — abort the hanging stream so the test exits cleanly
      act(() => {
        result.current.cancel();
      });
    });
  });

  describe("streaming text batching", () => {
    it("coalesces multiple text chunks into the final message content", async () => {
      const { streamingFetch } = await import("../streaming");
      const mockStream = vi.mocked(streamingFetch);
      mockStream.mockImplementation(async function* () {
        yield { type: "text" as const, content: "A" };
        yield { type: "text" as const, content: "B" };
        yield { type: "text" as const, content: "C" };
        yield { type: "text" as const, content: "D" };
        yield { type: "text" as const, content: "E" };
        yield { type: "done" as const, sessionId: "s1", usage: { input: 1, output: 1 } };
      });

      mockUseAIConfigs.mockReturnValue({
        data: { configs: [{ isActive: true, isValid: true, provider: "anthropic" }] },
      } as any);

      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.send("hello");
      });

      const lastMsg = result.current.messages[result.current.messages.length - 1];
      expect(lastMsg.role).toBe("assistant");
      expect(lastMsg.content).toBe("ABCDE");
    });

    it("flushes buffered text synchronously on done", async () => {
      const { streamingFetch } = await import("../streaming");
      const mockStream = vi.mocked(streamingFetch);
      mockStream.mockImplementation(async function* () {
        yield { type: "text" as const, content: "final" };
        yield { type: "done" as const, sessionId: "s2", usage: { input: 1, output: 1 } };
      });

      mockUseAIConfigs.mockReturnValue({
        data: { configs: [{ isActive: true, isValid: true, provider: "anthropic" }] },
      } as any);

      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.send("hi");
      });

      // After `done`, isStreaming must be false AND the text must be visible —
      // proving the pending rAF buffer flushed before the streaming lifecycle ended.
      expect(result.current.isStreaming).toBe(false);
      const lastMsg = result.current.messages[result.current.messages.length - 1];
      expect(lastMsg.content).toBe("final");
    });
  });

  describe("query invalidation batching", () => {
    it("defers scout invalidations until stream end", async () => {
      const { streamingFetch } = await import("../streaming");
      const mockStream = vi.mocked(streamingFetch);

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      let midStreamScoutCalls = -1;

      mockStream.mockImplementation(async function* () {
        yield { type: "tool_call" as const, id: "t1", name: "create_scout", args: {} };
        yield {
          type: "tool_result" as const,
          id: "t1",
          data: { ok: true },
          // No displayHint → should route through pendingInvalidations.add("scouts")
        };
        // Snapshot mid-stream — BEFORE done is emitted
        midStreamScoutCalls = invalidateSpy.mock.calls.filter(
          (c) => Array.isArray((c[0] as any)?.queryKey) && (c[0] as any).queryKey[0] === "scouts"
        ).length;
        yield { type: "done" as const, sessionId: "s1", usage: { input: 1, output: 1 } };
      });

      mockUseAIConfigs.mockReturnValue({
        data: { configs: [{ isActive: true, isValid: true, provider: "anthropic" }] },
      } as any);

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children);
      const { result } = renderHook(() => useOmnibar(), { wrapper });

      await act(async () => {
        await result.current.send("create a scout");
      });

      // Mid-stream, no invalidation for scouts (deferred)
      expect(midStreamScoutCalls).toBe(0);

      // Post-stream, exactly one invalidation for scouts (flushed from Set)
      const postStreamScoutCalls = invalidateSpy.mock.calls.filter(
        (c) => Array.isArray((c[0] as any)?.queryKey) && (c[0] as any).queryKey[0] === "scouts"
      ).length;
      expect(postStreamScoutCalls).toBe(1);
    });

    it("invalidates immediately on confirmation displayHint", async () => {
      const { streamingFetch } = await import("../streaming");
      const mockStream = vi.mocked(streamingFetch);

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      mockStream.mockImplementation(async function* () {
        yield { type: "tool_call" as const, id: "t1", name: "create_task", args: {} };
        yield {
          type: "tool_result" as const,
          id: "t1",
          data: { ok: true },
          displayHint: { type: "task_created" as const, taskId: "task-001" },
        };
        yield { type: "done" as const, sessionId: "s1", usage: { input: 1, output: 1 } };
      });

      mockUseAIConfigs.mockReturnValue({
        data: { configs: [{ isActive: true, isValid: true, provider: "anthropic" }] },
      } as any);

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children);
      const { result } = renderHook(() => useOmnibar(), { wrapper });

      await act(async () => {
        await result.current.send("make a task");
      });

      const thingsCalls = invalidateSpy.mock.calls.filter(
        (c) => Array.isArray((c[0] as any)?.queryKey) && (c[0] as any).queryKey[0] === "things"
      );
      expect(thingsCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("close and reset", () => {
    it("close clears search results", async () => {
      mockApiFetch.mockResolvedValue([{ id: "1", title: "Test", status: "active" }]);
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      act(() => result.current.open("bar"));
      await act(async () => {
        await result.current.searchThings("test");
      });
      expect(result.current.searchResults).not.toBeNull();

      act(() => result.current.close());
      expect(result.current.searchResults).toBeNull();
    });

    it("reset clears everything", async () => {
      mockApiFetch.mockResolvedValue([{ id: "1", title: "Test", status: "active" }]);
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      act(() => result.current.open("bar"));
      act(() => result.current.setInput("test"));
      await act(async () => {
        await result.current.searchThings("test");
      });

      act(() => result.current.reset());
      expect(result.current.input).toBe("");
      expect(result.current.messages).toHaveLength(0);
      expect(result.current.searchResults).toBeNull();
    });
  });
});
