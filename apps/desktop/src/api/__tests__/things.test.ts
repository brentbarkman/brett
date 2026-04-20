import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InboxResponse, Thing, ThingDetail } from "@brett/types";
import { useCreateThing, useUpdateThing } from "../things";

vi.mock("../client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../client";

const mockApiFetch = vi.mocked(apiFetch);

function makeThing(id: string, title: string): Thing {
  return {
    id,
    type: "task",
    title,
    list: "Inbox",
    listId: null,
    status: "active",
    source: "manual",
    urgency: "later",
    isCompleted: false,
  };
}

function makeDetail(id: string, title: string): ThingDetail {
  return {
    ...makeThing(id, title),
    attachments: [],
    links: [],
    brettMessages: [],
  };
}

function setupQueryClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

describe("useCreateThing optimistic insert", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts into inbox cache synchronously on mutate, before server responds", async () => {
    const { qc, wrapper } = setupQueryClient();

    // Pre-seed inbox cache with existing item
    const existing = makeThing("existing-1", "existing task");
    qc.setQueryData<InboxResponse>(["inbox"], { visible: [existing] });

    // Server response hangs until we release it — proves the cache update
    // happens BEFORE the network round-trip.
    let resolveServer: (t: Thing) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise<Thing>((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useCreateThing(), { wrapper });

    act(() => {
      result.current.mutate({ type: "task", title: "new task" });
    });

    // Before server resolves, inbox must already contain the new item.
    await waitFor(() => {
      const inbox = qc.getQueryData<InboxResponse>(["inbox"]);
      expect(inbox?.visible).toHaveLength(2);
      expect(inbox?.visible.some((t) => t.title === "new task")).toBe(true);
    });

    // Existing item is still there
    const inbox = qc.getQueryData<InboxResponse>(["inbox"]);
    expect(inbox?.visible.some((t) => t.id === "existing-1")).toBe(true);

    // Release server
    resolveServer(makeThing("server-id", "new task"));
  });

  it("rolls back inbox cache when the server rejects", async () => {
    const { qc, wrapper } = setupQueryClient();

    const existing = makeThing("existing-1", "existing task");
    qc.setQueryData<InboxResponse>(["inbox"], { visible: [existing] });

    mockApiFetch.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useCreateThing(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ type: "task", title: "will fail" });
      } catch {
        /* expected */
      }
    });

    const inbox = qc.getQueryData<InboxResponse>(["inbox"]);
    expect(inbox?.visible).toHaveLength(1);
    expect(inbox?.visible[0].id).toBe("existing-1");
  });

  it("does not insert content items into inbox cache unless they belong there", async () => {
    // Sanity: non-task types shouldn't pollute the inbox cache view if listId is set.
    // This documents the scope: only inbox-bound items go into the inbox cache.
    const { qc, wrapper } = setupQueryClient();
    qc.setQueryData<InboxResponse>(["inbox"], { visible: [] });

    let resolveServer: (t: Thing) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise<Thing>((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useCreateThing(), { wrapper });

    act(() => {
      result.current.mutate({ type: "task", title: "listed", listId: "list-abc" });
    });

    // Items with a listId bypass the inbox.
    await waitFor(() => {
      const inbox = qc.getQueryData<InboxResponse>(["inbox"]);
      expect(inbox?.visible).toHaveLength(0);
    });

    resolveServer(makeThing("server-id", "listed"));
  });
});

describe("useUpdateThing optimistic update", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates thing-detail cache synchronously on mutate (prevents title flash)", async () => {
    const { qc, wrapper } = setupQueryClient();

    const original = makeDetail("thing-1", "old title");
    qc.setQueryData<ThingDetail>(["thing-detail", "thing-1"], original);

    let resolveServer: (t: Thing) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise<Thing>((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useUpdateThing(), { wrapper });

    act(() => {
      result.current.mutate({ id: "thing-1", title: "new title" });
    });

    // Before server resolves, detail cache already reflects the new title.
    await waitFor(() => {
      const detail = qc.getQueryData<ThingDetail>(["thing-detail", "thing-1"]);
      expect(detail?.title).toBe("new title");
    });

    resolveServer(makeThing("thing-1", "new title"));
  });

  it("also updates inbox cache entries when they match the edited id", async () => {
    const { qc, wrapper } = setupQueryClient();

    qc.setQueryData<InboxResponse>(["inbox"], {
      visible: [makeThing("a", "a old"), makeThing("b", "b old")],
    });

    let resolveServer: (t: Thing) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise<Thing>((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useUpdateThing(), { wrapper });

    act(() => {
      result.current.mutate({ id: "a", title: "a new" });
    });

    await waitFor(() => {
      const inbox = qc.getQueryData<InboxResponse>(["inbox"]);
      expect(inbox?.visible.find((t) => t.id === "a")?.title).toBe("a new");
      expect(inbox?.visible.find((t) => t.id === "b")?.title).toBe("b old");
    });

    resolveServer(makeThing("a", "a new"));
  });

  it("rolls back thing-detail cache when the server rejects", async () => {
    const { qc, wrapper } = setupQueryClient();

    const original = makeDetail("thing-1", "old title");
    qc.setQueryData<ThingDetail>(["thing-detail", "thing-1"], original);

    mockApiFetch.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useUpdateThing(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "thing-1", title: "new title" });
      } catch {
        /* expected */
      }
    });

    const detail = qc.getQueryData<ThingDetail>(["thing-detail", "thing-1"]);
    expect(detail?.title).toBe("old title");
  });
});
