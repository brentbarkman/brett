import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InboxResponse, Thing, ThingDetail } from "@brett/types";
import { useCreateThing, useUpdateThing, useDeleteThing, useBulkUpdateThings, __testing } from "../things";

const { thingMatchesFilters } = __testing;

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

  // Follow-up from #62: Today quick-add passes dueDate=today, so it must
  // land in the active-this-week cache (useActiveThings) immediately.
  it("inserts a today-dated task into the active/dueBefore cache", async () => {
    const { qc, wrapper } = setupQueryClient();

    const today = new Date("2026-04-20T00:00:00.000Z").toISOString();
    const endOfWeek = new Date("2026-04-26T23:59:59.999Z").toISOString();
    const activeFilters = { status: "active" as const, dueBefore: endOfWeek };

    qc.setQueryData<Thing[]>(["things", activeFilters], []);

    let resolveServer: (t: Thing) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise<Thing>((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useCreateThing(), { wrapper });

    act(() => {
      result.current.mutate({
        type: "task",
        title: "today task",
        dueDate: today,
        dueDatePrecision: "day",
      });
    });

    await waitFor(() => {
      const cache = qc.getQueryData<Thing[]>(["things", activeFilters]);
      expect(cache).toHaveLength(1);
      expect(cache?.[0].title).toBe("today task");
    });

    resolveServer(makeThing("server-id", "today task"));
  });

  // Follow-up from #62: List-scoped add must land in the list's cache
  // (useListThings → ["things", { listId }]) immediately.
  it("inserts a list-scoped task into the matching ['things', { listId }] cache", async () => {
    const { qc, wrapper } = setupQueryClient();

    qc.setQueryData<Thing[]>(["things", { listId: "list-abc" }], []);
    qc.setQueryData<Thing[]>(["things", { listId: "other-list" }], []);

    let resolveServer: (t: Thing) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise<Thing>((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useCreateThing(), { wrapper });

    act(() => {
      result.current.mutate({ type: "task", title: "listed task", listId: "list-abc" });
    });

    await waitFor(() => {
      const abc = qc.getQueryData<Thing[]>(["things", { listId: "list-abc" }]);
      expect(abc).toHaveLength(1);
      expect(abc?.[0].title).toBe("listed task");
    });

    // The other list's cache must stay empty.
    const other = qc.getQueryData<Thing[]>(["things", { listId: "other-list" }]);
    expect(other).toHaveLength(0);

    resolveServer(makeThing("server-id", "listed task"));
  });

  // New creates are never pre-completed, so they must never land in a
  // done/completedAfter view — guards against a Today view briefly showing
  // a just-created item in its "done today" section.
  it("does not insert into done/completedAfter caches", async () => {
    const { qc, wrapper } = setupQueryClient();

    const today = new Date("2026-04-20T00:00:00.000Z").toISOString();
    const doneFilters = { status: "done" as const, completedAfter: today };
    qc.setQueryData<Thing[]>(["things", doneFilters], []);

    let resolveServer: (t: Thing) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise<Thing>((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useCreateThing(), { wrapper });

    act(() => {
      result.current.mutate({ type: "task", title: "fresh", dueDate: today });
    });

    await waitFor(() => {
      const cache = qc.getQueryData<Thing[]>(["things", doneFilters]);
      expect(cache).toHaveLength(0);
    });

    resolveServer(makeThing("server-id", "fresh"));
  });

  it("rolls back every ['things', ...] cache it optimistically wrote on error", async () => {
    const { qc, wrapper } = setupQueryClient();

    const today = new Date("2026-04-20T00:00:00.000Z").toISOString();
    const endOfWeek = new Date("2026-04-26T23:59:59.999Z").toISOString();
    const activeFilters = { status: "active" as const, dueBefore: endOfWeek };
    const seed = makeThing("seed-1", "seeded");
    qc.setQueryData<Thing[]>(["things", activeFilters], [seed]);

    mockApiFetch.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useCreateThing(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          type: "task",
          title: "will fail",
          dueDate: today,
        });
      } catch {
        /* expected */
      }
    });

    const cache = qc.getQueryData<Thing[]>(["things", activeFilters]);
    expect(cache).toEqual([seed]);
  });
});

describe("useDeleteThing optimistic remove", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes the item from inbox and every ['things', ...] cache before the server responds", async () => {
    const { qc, wrapper } = setupQueryClient();

    qc.setQueryData<InboxResponse>(["inbox"], {
      visible: [makeThing("a", "keep"), makeThing("b", "gone")],
    });
    qc.setQueryData<Thing[]>(["things", { listId: "L1" }], [makeThing("b", "gone"), makeThing("c", "keep")]);
    qc.setQueryData<Thing[]>(["things", { status: "active" }], [makeThing("b", "gone")]);

    let resolveServer: (v: unknown) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useDeleteThing(), { wrapper });

    act(() => {
      result.current.mutate("b");
    });

    await waitFor(() => {
      const inbox = qc.getQueryData<InboxResponse>(["inbox"]);
      expect(inbox?.visible.map((t) => t.id)).toEqual(["a"]);
      expect(qc.getQueryData<Thing[]>(["things", { listId: "L1" }])?.map((t) => t.id)).toEqual(["c"]);
      expect(qc.getQueryData<Thing[]>(["things", { status: "active" }])).toEqual([]);
    });

    resolveServer({});
  });

  it("rolls back every cache it touched on error", async () => {
    const { qc, wrapper } = setupQueryClient();

    const inboxSeed = [makeThing("a", "keep"), makeThing("b", "will-fail")];
    const listSeed = [makeThing("b", "will-fail")];
    qc.setQueryData<InboxResponse>(["inbox"], { visible: inboxSeed });
    qc.setQueryData<Thing[]>(["things", { listId: "L1" }], listSeed);

    mockApiFetch.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useDeleteThing(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync("b");
      } catch { /* expected */ }
    });

    expect(qc.getQueryData<InboxResponse>(["inbox"])?.visible.map((t) => t.id)).toEqual(["a", "b"]);
    expect(qc.getQueryData<Thing[]>(["things", { listId: "L1" }])?.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("useBulkUpdateThings optimistic patch/remove", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes archived items from the inbox immediately", async () => {
    const { qc, wrapper } = setupQueryClient();

    qc.setQueryData<InboxResponse>(["inbox"], {
      visible: [makeThing("a", "a"), makeThing("b", "b"), makeThing("c", "c")],
    });

    let resolveServer: (v: unknown) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useBulkUpdateThings(), { wrapper });

    act(() => {
      result.current.mutate({ ids: ["a", "c"], updates: { status: "archived" } });
    });

    await waitFor(() => {
      expect(qc.getQueryData<InboxResponse>(["inbox"])?.visible.map((t) => t.id)).toEqual(["b"]);
    });

    resolveServer({ updated: 2 });
  });

  it("patches in place when updates don't change the inbox membership (drag-to-list)", async () => {
    const { qc, wrapper } = setupQueryClient();

    qc.setQueryData<Thing[]>(["things", { listId: "L1" }], [
      { ...makeThing("a", "a"), listId: "L1" },
    ]);

    let resolveServer: (v: unknown) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useBulkUpdateThings(), { wrapper });

    act(() => {
      result.current.mutate({ ids: ["a"], updates: { listId: "L2" } });
    });

    await waitFor(() => {
      const cache = qc.getQueryData<Thing[]>(["things", { listId: "L1" }]);
      expect(cache?.[0].listId).toBe("L2");
    });

    resolveServer({ updated: 1 });
  });
});

describe("thingMatchesFilters", () => {
  const baseThing: Thing = {
    id: "x",
    type: "task",
    title: "x",
    list: "Inbox",
    listId: null,
    status: "active",
    source: "manual",
    urgency: "later",
    isCompleted: false,
  };

  it("matches when all filters are empty", () => {
    expect(thingMatchesFilters(baseThing, {})).toBe(true);
  });

  it("respects listId equality", () => {
    const t = { ...baseThing, listId: "abc" };
    expect(thingMatchesFilters(t, { listId: "abc" })).toBe(true);
    expect(thingMatchesFilters(t, { listId: "xyz" })).toBe(false);
    expect(thingMatchesFilters(baseThing, { listId: "abc" })).toBe(false);
  });

  it("treats dueBefore as inclusive and excludes null dueDate", () => {
    const due = "2026-04-20T00:00:00.000Z";
    const eow = "2026-04-26T00:00:00.000Z";
    expect(thingMatchesFilters({ ...baseThing, dueDate: due }, { dueBefore: eow })).toBe(true);
    expect(thingMatchesFilters({ ...baseThing, dueDate: eow }, { dueBefore: eow })).toBe(true);
    expect(thingMatchesFilters({ ...baseThing, dueDate: "2026-05-01T00:00:00.000Z" }, { dueBefore: eow })).toBe(false);
    expect(thingMatchesFilters(baseThing, { dueBefore: eow })).toBe(false);
  });

  it("treats dueAfter as exclusive and excludes null dueDate", () => {
    const today = "2026-04-20T00:00:00.000Z";
    expect(thingMatchesFilters({ ...baseThing, dueDate: today }, { dueAfter: today })).toBe(false);
    expect(thingMatchesFilters({ ...baseThing, dueDate: "2026-04-21T00:00:00.000Z" }, { dueAfter: today })).toBe(true);
    expect(thingMatchesFilters(baseThing, { dueAfter: today })).toBe(false);
  });

  it("never matches a completedAfter filter (new items aren't pre-completed)", () => {
    expect(thingMatchesFilters(baseThing, { completedAfter: "2026-04-20T00:00:00.000Z" })).toBe(false);
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
