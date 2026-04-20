import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Attachment, ItemLink, Thing, ThingDetail } from "@brett/types";
import { useCreateLink, useDeleteLink } from "../links";
import { useDeleteAttachment } from "../attachments";

vi.mock("../client", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "../client";

const mockApiFetch = vi.mocked(apiFetch);

function makeDetail(id: string, overrides: Partial<ThingDetail> = {}): ThingDetail {
  const base: Thing = {
    id,
    type: "task",
    title: "t",
    list: "Inbox",
    listId: null,
    status: "active",
    source: "manual",
    urgency: "later",
    isCompleted: false,
  };
  return {
    ...base,
    attachments: [],
    links: [],
    brettMessages: [],
    ...overrides,
  };
}

function makeAttachment(id: string): Attachment {
  return {
    id,
    filename: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 100,
    url: "https://example.com/x",
    createdAt: "2026-04-20T00:00:00Z",
  };
}

function makeLink(id: string, toItemId = "other"): ItemLink {
  return {
    id,
    toItemId,
    toItemType: "task",
    source: "manual",
    createdAt: "2026-04-20T00:00:00Z",
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

describe("useCreateLink optimistic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("appends a provisional link to thing-detail before the server responds", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<ThingDetail>(["thing-detail", "item-1"], makeDetail("item-1"));

    let resolveServer: (v: ItemLink) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise<ItemLink>((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useCreateLink(), { wrapper });

    act(() => {
      result.current.mutate({ itemId: "item-1", toItemId: "target-x", toItemType: "task" });
    });

    await waitFor(() => {
      const detail = qc.getQueryData<ThingDetail>(["thing-detail", "item-1"]);
      expect(detail?.links).toHaveLength(1);
      expect(detail?.links[0].toItemId).toBe("target-x");
    });

    resolveServer({ id: "server-id", toItemId: "target-x", toItemType: "task", createdAt: "x" });
  });
});

describe("useDeleteLink optimistic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes the link from thing-detail before the server responds", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<ThingDetail>(["thing-detail", "item-1"], makeDetail("item-1", {
      links: [makeLink("link-a"), makeLink("link-b")],
    }));

    let resolveServer: (v: unknown) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useDeleteLink(), { wrapper });

    act(() => {
      result.current.mutate({ itemId: "item-1", linkId: "link-a" });
    });

    await waitFor(() => {
      const detail = qc.getQueryData<ThingDetail>(["thing-detail", "item-1"]);
      expect(detail?.links.map((l) => l.id)).toEqual(["link-b"]);
    });

    resolveServer({});
  });
});

describe("useDeleteAttachment optimistic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes the attachment from thing-detail before the server responds", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<ThingDetail>(["thing-detail", "item-1"], makeDetail("item-1", {
      attachments: [makeAttachment("a1"), makeAttachment("a2")],
    }));

    let resolveServer: (v: unknown) => void = () => {};
    mockApiFetch.mockImplementation(
      () => new Promise((resolve) => { resolveServer = resolve; }),
    );

    const { result } = renderHook(() => useDeleteAttachment(), { wrapper });

    act(() => {
      result.current.mutate({ itemId: "item-1", attachmentId: "a1" });
    });

    await waitFor(() => {
      const detail = qc.getQueryData<ThingDetail>(["thing-detail", "item-1"]);
      expect(detail?.attachments.map((a) => a.id)).toEqual(["a2"]);
    });

    resolveServer({});
  });
});
