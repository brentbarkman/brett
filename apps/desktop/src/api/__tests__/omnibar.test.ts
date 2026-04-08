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
    it("calls API with title and type task", async () => {
      mockApiFetch.mockResolvedValue({ id: "123", title: "Buy groceries" });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.createTask("Buy groceries");
      });

      expect(mockApiFetch).toHaveBeenCalledWith("/things", {
        method: "POST",
        body: JSON.stringify({ title: "Buy groceries", type: "task" }),
        headers: { "Content-Type": "application/json" },
      });
    });

    it("sets dueDate to today when on today view", async () => {
      mockApiFetch.mockResolvedValue({ id: "123", title: "Test" });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      const today = new Date().toISOString().split("T")[0];

      await act(async () => {
        await result.current.createTask("Test task", "today");
      });

      const callBody = JSON.parse(mockApiFetch.mock.calls[0][1]!.body as string);
      expect(callBody.dueDate).toBe(today);
    });

    it("sets listId when on a list view", async () => {
      mockApiFetch.mockResolvedValue({ id: "123", title: "Test" });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.createTask("Test task", "list:abc123def456");
      });

      const callBody = JSON.parse(mockApiFetch.mock.calls[0][1]!.body as string);
      expect(callBody.listId).toBe("abc123def456");
    });

    it("sets no dueDate or listId for other views", async () => {
      mockApiFetch.mockResolvedValue({ id: "123", title: "Test" });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.createTask("Test task", "inbox");
      });

      const callBody = JSON.parse(mockApiFetch.mock.calls[0][1]!.body as string);
      expect(callBody.dueDate).toBeUndefined();
      expect(callBody.listId).toBeUndefined();
    });

    it("closes omnibar after creating task", async () => {
      mockApiFetch.mockResolvedValue({ id: "123", title: "Test" });
      const { result } = renderHook(() => useOmnibar(), { wrapper: createWrapper() });

      // Open first
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
