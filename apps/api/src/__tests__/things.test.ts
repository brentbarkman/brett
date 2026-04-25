import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { app } from "../app.js";
import { DEFAULT_LIST_NAME } from "@brett/business";
import { prisma } from "../lib/prisma.js";

describe("Things routes", () => {
  let token: string;
  let listId: string;

  beforeAll(async () => {
    const user = await createTestUser("Things User");
    token = user.token;

    // Create a list for items
    const listRes = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Work", colorClass: "bg-blue-500" }),
    });
    const list = (await listRes.json()) as any;
    listId = list.id;
  });

  it("GET /things returns empty array initially", async () => {
    const res = await authRequest("/things", token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /things creates a thing", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "task",
        title: "My first task",
        listId,
        description: "A description",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.title).toBe("My first task");
    expect(body.type).toBe("task");
    expect(body.list).toBe("Work");
    expect(body.status).toBe("active");
    expect(body.isCompleted).toBe(false);
    expect(body.source).toBe("Brett");
    expect(body.description).toBe("A description");
  });

  it("POST /things creates a thing without listId (inbox)", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "task",
        title: "Inbox task",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.title).toBe("Inbox task");
    expect(body.list).toBe(DEFAULT_LIST_NAME);
    expect(body.listId).toBeNull();
    expect(body.status).toBe("active");
  });

  it("POST /things rejects missing title", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", listId }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /things rejects invalid type", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "banana", title: "Bad", listId }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /things rejects invalid listId", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "task",
        title: "Bad list",
        listId: "nonexistent",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /things returns created things", async () => {
    const res = await authRequest("/things", token);
    const body = (await res.json()) as any[];
    expect(body.length).toBeGreaterThanOrEqual(2);
    // Ordered by createdAt desc — newest first
    expect(body.map((t: any) => t.title)).toContain("My first task");
    expect(body.map((t: any) => t.title)).toContain("Inbox task");
  });

  it("GET /things filters by status", async () => {
    const res = await authRequest("/things?status=active", token);
    const body = (await res.json()) as any[];
    expect(body.every((t: any) => t.status === "active")).toBe(true);
  });

  it("GET /things filters by type", async () => {
    const res = await authRequest("/things?type=task", token);
    const body = (await res.json()) as any[];
    expect(body.every((t: any) => t.type === "task")).toBe(true);
  });

  it("GET /things/:id returns a single thing", async () => {
    const listRes = await authRequest("/things", token);
    const things = (await listRes.json()) as any[];
    const id = things[0].id;

    const res = await authRequest(`/things/${id}`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe(id);
  });

  it("GET /things/:id returns 404 for nonexistent", async () => {
    const res = await authRequest("/things/nonexistent", token);
    expect(res.status).toBe(404);
  });

  it("PATCH /things/:id updates a thing", async () => {
    const listRes = await authRequest("/things", token);
    const things = (await listRes.json()) as any[];
    const id = things[0].id;

    const res = await authRequest(`/things/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ title: "Updated title", status: "active" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.title).toBe("Updated title");
    expect(body.status).toBe("active");
  });

  it("PATCH /things/:id can move thing to inbox (null listId)", async () => {
    // Get a thing that has a list
    const listRes = await authRequest("/things", token);
    const things = (await listRes.json()) as any[];
    const withList = things.find((t: any) => t.listId !== null);

    const res = await authRequest(`/things/${withList.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ listId: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.listId).toBeNull();
    expect(body.list).toBe(DEFAULT_LIST_NAME);
  });

  it("PATCH /things/:id/toggle toggles completion", async () => {
    const listRes = await authRequest("/things", token);
    const things = (await listRes.json()) as any[];
    const id = things[0].id;

    // Toggle on
    const res1 = await authRequest(`/things/${id}/toggle`, token, {
      method: "PATCH",
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as any;
    expect(body1.isCompleted).toBe(true);
    expect(body1.status).toBe("done");

    // Toggle off
    const res2 = await authRequest(`/things/${id}/toggle`, token, {
      method: "PATCH",
    });
    const body2 = (await res2.json()) as any;
    expect(body2.isCompleted).toBe(false);
    expect(body2.status).toBe("active");
  });

  it("DELETE /things/:id deletes a thing", async () => {
    // Create one to delete
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Delete me", listId }),
    });
    const { id } = (await createRes.json()) as any;

    const res = await authRequest(`/things/${id}`, token, { method: "DELETE" });
    expect(res.status).toBe(200);

    // Verify gone
    const getRes = await authRequest(`/things/${id}`, token);
    expect(getRes.status).toBe(404);
  });

  // ── Bulk Update Tests ──

  it("PATCH /things/bulk updates multiple items", async () => {
    // Create two inbox items
    const res1 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Bulk item 1" }),
    });
    const res2 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Bulk item 2" }),
    });
    const id1 = ((await res1.json()) as any).id;
    const id2 = ((await res2.json()) as any).id;

    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({
        ids: [id1, id2],
        updates: { listId },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.updated).toBe(2);
  });

  it("PATCH /things/bulk rejects empty ids", async () => {
    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({ ids: [], updates: { listId } }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /things/bulk rejects > 100 ids", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `fake-${i}`);
    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({ ids, updates: { listId } }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /things/bulk rejects wrong user's ids", async () => {
    const otherUser = await createTestUser("Bulk Other User");
    const createRes = await authRequest("/things", otherUser.token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Other user item" }),
    });
    const otherId = ((await createRes.json()) as any).id;

    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({ ids: [otherId], updates: { status: "archived" } }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /things/bulk rejects invalid listId", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Bulk invalid list" }),
    });
    const id = ((await createRes.json()) as any).id;

    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({ ids: [id], updates: { listId: "nonexistent" } }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /things/bulk with dueDate", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Bulk date item" }),
    });
    const id = ((await createRes.json()) as any).id;

    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({
        ids: [id],
        updates: { dueDate: "2026-03-20T00:00:00Z" },
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).updated).toBe(1);
  });

  // ── Inbox Tests ──

  it("GET /things/inbox returns only null-listId items", async () => {
    const res = await authRequest("/things/inbox", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.visible).toBeDefined();
    // All visible items should have null listId
    for (const item of body.visible) {
      expect(item.listId).toBeNull();
    }
  });

  it("GET /things/inbox excludes done and archived items", async () => {
    // Create an inbox item and archive it
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Archived inbox item" }),
    });
    const id = ((await createRes.json()) as any).id;
    await authRequest(`/things/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });

    const res = await authRequest("/things/inbox", token);
    const body = (await res.json()) as any;
    const archivedInInbox = body.visible.find((t: any) => t.id === id);
    expect(archivedInInbox).toBeUndefined();
  });

  it("GET /things/inbox excludes items with due dates", async () => {
    const user = await createTestUser("Inbox Dated User");

    await authRequest("/things", user.token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Dated No List", dueDate: "2026-03-20T00:00:00Z", dueDatePrecision: "day" }),
    });
    await authRequest("/things", user.token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "No Date No List" }),
    });

    const res = await authRequest("/things/inbox", user.token);
    const body = (await res.json()) as any;
    expect(body.visible.length).toBe(1);
    expect(body.visible[0].title).toBe("No Date No List");
  });

  it("GET /things/:id returns ThingDetail with relations", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Detail test", listId }),
    });
    const thing = (await createRes.json()) as any;

    const res = await authRequest(`/things/${thing.id}`, token);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as any;
    expect(detail.id).toBe(thing.id);
    expect(detail.attachments).toEqual([]);
    expect(detail.links).toEqual([]);
    expect(detail.brettMessages).toEqual([]);
  });

  it("PATCH /things/:id updates notes, reminder, and recurrence", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Update fields test", listId }),
    });
    const thing = (await createRes.json()) as any;

    const res = await authRequest(`/things/${thing.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        notes: "# Hello\nSome **bold** text",
        reminder: "morning_of",
        recurrence: "weekly",
      }),
    });
    expect(res.status).toBe(200);

    const detailRes = await authRequest(`/things/${thing.id}`, token);
    const detail = (await detailRes.json()) as any;
    expect(detail.notes).toBe("# Hello\nSome **bold** text");
    expect(detail.reminder).toBe("morning_of");
    expect(detail.recurrence).toBe("weekly");
  });

  it("PATCH /things/:id rejects oversized notes", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Notes limit test", listId }),
    });
    const thing = (await createRes.json()) as any;

    const res = await authRequest(`/things/${thing.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ notes: "x".repeat(100_001) }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /things returns 401 without auth", async () => {
    const res = await app.request("/things");
    expect(res.status).toBe(401);
  });

  it("POST /things creates a content item with sourceUrl", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "https://medium.com/some-article",
        sourceUrl: "https://medium.com/some-article",
        source: "medium.com",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.type).toBe("content");
    expect(body.sourceUrl).toBe("https://medium.com/some-article");
    expect(body.source).toBe("medium.com");
  });

  it("POST /things creates content with contentType and auto-sets pending status", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "https://youtube.com/watch?v=abc",
        sourceUrl: "https://youtube.com/watch?v=abc",
        contentType: "video",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.contentType).toBe("video");
    expect(body.contentStatus).toBe("pending");
  });

  it("GET /things/:id returns content detail fields", async () => {
    // Create without sourceUrl to avoid triggering auto-extraction (which races with the PATCH below)
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "Test Article",
      }),
    });
    const created = (await createRes.json()) as any;

    await authRequest(`/things/${created.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        sourceUrl: "https://example.com/article",
        contentType: "article",
        contentStatus: "extracted",
        contentTitle: "Original Title",
        contentDescription: "A great article",
        contentBody: "# Hello\n\nWorld",
        contentDomain: "example.com",
        contentFavicon: "https://example.com/favicon.ico",
        contentMetadata: { type: "article", author: "Test" },
      }),
    });

    const detailRes = await authRequest(`/things/${created.id}`, token);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as any;
    expect(detail.contentType).toBe("article");
    expect(detail.contentStatus).toBe("extracted");
    expect(detail.contentTitle).toBe("Original Title");
    expect(detail.contentDescription).toBe("A great article");
    expect(detail.contentBody).toBe("# Hello\n\nWorld");
    expect(detail.contentDomain).toBe("example.com");
    expect(detail.contentMetadata).toEqual({ type: "article", author: "Test" });
  });

  it("GET /things filters by type=content", async () => {
    const res = await authRequest("/things?type=content", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    for (const item of body) {
      expect(item.type).toBe("content");
    }
  });

  it("things are isolated between users", async () => {
    const otherUser = await createTestUser("Other Things User");
    const res = await authRequest("/things", otherUser.token);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(0);
  });
});

describe("GET /things?dueAfter", () => {
  let daToken: string;

  beforeAll(async () => {
    const user = await createTestUser("DueAfter User");
    daToken = user.token;

    await authRequest("/things", daToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Past", dueDate: "2026-03-10T00:00:00Z", dueDatePrecision: "day" }),
    });
    await authRequest("/things", daToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Today", dueDate: "2026-03-16T00:00:00Z", dueDatePrecision: "day" }),
    });
    await authRequest("/things", daToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Future", dueDate: "2026-03-20T00:00:00Z", dueDatePrecision: "day" }),
    });
  });

  it("filters items with dueDate after the given date", async () => {
    const res = await authRequest("/things?dueAfter=2026-03-16T00:00:00Z", daToken);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(1);
    expect(body[0].title).toBe("Future");
  });

  it("works with dueBefore for date range", async () => {
    const res = await authRequest("/things?dueAfter=2026-03-09T00:00:00Z&dueBefore=2026-03-17T00:00:00Z", daToken);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(2);
    const titles = body.map((t: any) => t.title).sort();
    expect(titles).toEqual(["Past", "Today"]);
  });
});

/**
 * The shared `paginatedPull` core means /things and /sync/pull no longer
 * have parallel pagination implementations, AND /things now walks until
 * exhausted server-side instead of silently truncating at 500 rows. These
 * tests pin both invariants — without them, a future regression could
 * reintroduce either failure mode without obvious symptoms in dev.
 */
describe("GET /things — pagination correctness via shared sync core", () => {
  let token: string;
  let userId: string;
  let seededIds: string[];

  beforeAll(async () => {
    const user = await createTestUser("Things Pagination");
    token = user.token;
    userId = user.userId;

    // Bulk-seed 600 items — well past the old `take: 500` desktop cap —
    // via direct Prisma to avoid serializing 600 HTTP POSTs (slow + would
    // trip route rate limits inside the full test suite). Before the
    // shared-core refactor, /things silently dropped the oldest 100 of
    // these. The tests below pin that the full set now comes back.
    const created = await prisma.item.createManyAndReturn({
      data: Array.from({ length: 600 }, (_, i) => ({
        userId,
        type: "task",
        status: "active",
        title: `bulk-${i}`,
      })),
    });
    seededIds = created.map((r) => r.id);
  });

  it("returns the full matching set for users above the legacy 500-row truncation", async () => {
    const res = await authRequest("/things", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    // The full set should come back — no silent truncation. The 2000-row
    // default cap on /things is well above 600 so we expect every row.
    expect(body.length).toBe(seededIds.length);
    expect(new Set(body.map((t: any) => t.id))).toEqual(new Set(seededIds));
  });

  it("returns identical id sets across two consecutive calls — determinism", async () => {
    // Mirrors the "two iOS sign-ins disagree" guard from paginated-pull
    // tests, but at the route level. If the cursor stream is deterministic
    // for an unchanging dataset, both calls must produce identical sets.
    const res1 = await authRequest("/things", token);
    const res2 = await authRequest("/things", token);
    const body1 = (await res1.json()) as any[];
    const body2 = (await res2.json()) as any[];
    expect(new Set(body1.map((t: any) => t.id))).toEqual(new Set(body2.map((t: any) => t.id)));
  });

  it("filters paginate correctly across the internal page size — `status=active` returns all matching rows", async () => {
    // Mark 50 of the seeded rows complete so we have a mixed dataset
    // that crosses the internal page boundary (200). If filtering were
    // applied AFTER pagination instead of THROUGH it, the active count
    // could come back wrong.
    const toComplete = seededIds.slice(0, 50);
    await prisma.item.updateMany({
      where: { id: { in: toComplete } },
      data: { status: "done", completedAt: new Date() },
    });

    const res = await authRequest("/things?status=active", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body.every((t: any) => t.status === "active")).toBe(true);
    expect(body.length).toBe(seededIds.length - toComplete.length);

    // Reset the dataset so subsequent tests in this describe see all 600
    // again. Don't go through the route's PATCH (rate limit risk).
    await prisma.item.updateMany({
      where: { id: { in: toComplete } },
      data: { status: "active", completedAt: null },
    });
  });

  it("respects an explicit `?limit=` request below the default cap", async () => {
    const res = await authRequest("/things?limit=37", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body.length).toBeLessThanOrEqual(37);
  });

  it("clamps an absurd `?limit=` to the hard maximum", async () => {
    // 999_999 must not OOM the server — the route caps at 5000 internally.
    const res = await authRequest("/things?limit=999999", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body.length).toBeLessThanOrEqual(5000);
  });

  it("never returns rows belonging to a different user — IDOR defense on the hydrate query", async () => {
    // Defense-in-depth check: paginatedPull already scopes by user, but
    // the route's hydrate findMany is the second line of defense. If a
    // future bug let a foreign id leak into the accumulated set, the
    // hydrate would still drop it because of the userId clause.
    const otherUser = await createTestUser("Things Pagination Other");
    await prisma.item.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        userId: otherUser.userId,
        type: "task",
        status: "active",
        title: `other-${i}`,
      })),
    });

    const res = await authRequest("/things", token);
    const body = (await res.json()) as any[];
    const titles = new Set(body.map((t: any) => t.title));
    for (let i = 0; i < 20; i++) {
      expect(titles.has(`other-${i}`)).toBe(false);
    }
  });
});

/**
 * Cross-route parity: /things and /sync/pull must surface the same id set
 * for the items table when called with no filters and a fresh cursor.
 * They diverged for years before the shared-core refactor, which was the
 * architectural asymmetry behind the iOS-vs-Electron count divergence.
 * Pin the parity here so a future drift can't sneak back in.
 */
describe("/things ↔ /sync/pull cross-route parity", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser("Sync Things Parity");
    token = user.token;
    userId = user.userId;
    await prisma.item.createMany({
      data: Array.from({ length: 75 }, (_, i) => ({
        userId,
        type: "task",
        status: "active",
        title: `parity-${i}`,
      })),
    });
  });

  it("both endpoints return the same id set when no filter is applied", async () => {
    const thingsRes = await authRequest("/things", token);
    const thingsBody = (await thingsRes.json()) as any[];

    // Walk /sync/pull until exhausted, collecting items.
    const seen = new Set<string>();
    let cursors: Record<string, string> = {};
    for (let safety = 0; safety < 50; safety++) {
      const res = await authRequest("/sync/pull", token, {
        method: "POST",
        body: JSON.stringify({ protocolVersion: 1, cursors }),
      });
      const body = (await res.json()) as any;
      for (const row of body.changes.items.upserted) seen.add(row.id);
      const anyMore = Object.values(body.changes).some((c: any) => c.hasMore);
      cursors = body.cursors;
      if (!anyMore) break;
    }

    expect(new Set(thingsBody.map((t: any) => t.id))).toEqual(seen);
  });
});
