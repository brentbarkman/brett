import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NavList } from "@brett/types";
import {
  useCreateList,
  useUpdateList,
  useDeleteList,
  useArchiveList,
  useUnarchiveList,
} from "../lists";

vi.mock("../client", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "../client";

const mockApiFetch = vi.mocked(apiFetch);

function makeList(id: string, name: string, archived = false): NavList {
  return {
    id,
    name,
    count: 0,
    completedCount: 0,
    colorClass: "white",
    sortOrder: 0,
    archivedAt: archived ? new Date().toISOString() : null,
  };
}

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

describe("useCreateList optimistic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prepends a provisional list before the server responds", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<NavList[]>(["lists"], [makeList("existing", "Existing")]);

    let resolveServer: (v: NavList) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise<NavList>((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useCreateList(), { wrapper });

    act(() => {
      result.current.mutate({ name: "New List" });
    });

    await waitFor(() => {
      const lists = qc.getQueryData<NavList[]>(["lists"]);
      expect(lists).toHaveLength(2);
      expect(lists?.[0].name).toBe("New List");
    });

    resolveServer(makeList("server-id", "New List"));
  });

  it("replaces the temp entry with the real server record on success", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<NavList[]>(["lists"], []);

    mockApiFetch.mockResolvedValue(makeList("server-id", "New"));

    const { result } = renderHook(() => useCreateList(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "New" });
    });

    const lists = qc.getQueryData<NavList[]>(["lists"]);
    expect(lists).toHaveLength(1);
    expect(lists?.[0].id).toBe("server-id");
  });

  it("rolls back to the prior cache on error", async () => {
    const { qc, wrapper } = setup();
    const seed = [makeList("existing", "Existing")];
    qc.setQueryData<NavList[]>(["lists"], seed);

    mockApiFetch.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useCreateList(), { wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ name: "Will fail" });
      } catch { /* expected */ }
    });

    expect(qc.getQueryData<NavList[]>(["lists"])).toEqual(seed);
  });
});

describe("useUpdateList optimistic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("patches the list in place before the server responds (prevents rename flash)", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<NavList[]>(["lists"], [makeList("a", "old name")]);

    let resolveServer: (v: NavList) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise<NavList>((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useUpdateList(), { wrapper });

    act(() => {
      result.current.mutate({ id: "a", name: "new name" });
    });

    await waitFor(() => {
      expect(qc.getQueryData<NavList[]>(["lists"])?.[0].name).toBe("new name");
    });

    resolveServer(makeList("a", "new name"));
  });
});

describe("useDeleteList optimistic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes the list from ['lists'] immediately", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<NavList[]>(["lists"], [makeList("a", "a"), makeList("b", "b")]);

    let resolveServer: (v: unknown) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useDeleteList(), { wrapper });

    act(() => {
      result.current.mutate("a");
    });

    await waitFor(() => {
      expect(qc.getQueryData<NavList[]>(["lists"])?.map((l) => l.id)).toEqual(["b"]);
    });

    resolveServer({});
  });
});

describe("useArchiveList / useUnarchiveList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves a list from ['lists'] to ['lists', 'archived'] on archive", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<NavList[]>(["lists"], [makeList("a", "a")]);
    qc.setQueryData<NavList[]>(["lists", "archived"], []);

    let resolveServer: (v: unknown) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useArchiveList(), { wrapper });

    act(() => {
      result.current.mutate("a");
    });

    await waitFor(() => {
      expect(qc.getQueryData<NavList[]>(["lists"])).toEqual([]);
      expect(qc.getQueryData<NavList[]>(["lists", "archived"])?.map((l) => l.id)).toEqual(["a"]);
    });

    resolveServer({ archivedAt: "2026-01-01T00:00:00Z", itemsCompleted: 0 });
  });

  it("moves a list back from archived on unarchive", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<NavList[]>(["lists"], []);
    qc.setQueryData<NavList[]>(["lists", "archived"], [makeList("a", "a", true)]);

    let resolveServer: (v: NavList) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise<NavList>((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useUnarchiveList(), { wrapper });

    act(() => {
      result.current.mutate("a");
    });

    await waitFor(() => {
      expect(qc.getQueryData<NavList[]>(["lists", "archived"])).toEqual([]);
      expect(qc.getQueryData<NavList[]>(["lists"])?.map((l) => l.id)).toEqual(["a"]);
    });

    resolveServer(makeList("a", "a"));
  });
});
