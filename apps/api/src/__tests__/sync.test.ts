import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/encryption.js";
import { clearAllRateLimits } from "../middleware/rate-limit.js";
import { SYNC_TABLES, MUTABLE_FIELDS } from "@brett/types";
import { generateId } from "@brett/utils";
import type { SyncPushRequest, SyncPushResponse } from "@brett/types";

// Required for encryptToken used when creating GoogleAccount fixtures
process.env.CALENDAR_TOKEN_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("POST /sync/pull", () => {
  let token: string;
  let userId: string;
  let listId: string;
  let itemId: string;

  beforeAll(async () => {
    const user = await createTestUser("Sync User");
    token = user.token;
    userId = user.userId;

    // Create a list and an item for sync testing
    const listRes = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Sync Test List", colorClass: "bg-blue-500" }),
    });
    listId = ((await listRes.json()) as any).id;

    const itemRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Sync Test Item", listId }),
    });
    itemId = ((await itemRes.json()) as any).id;
  });

  it("returns changes for all tables on full sync (empty cursors)", async () => {
    clearAllRateLimits();
    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: 1,
        cursors: {},
      }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.serverTime).toBeDefined();
    expect(body.changes).toBeDefined();
    expect(body.cursors).toBeDefined();

    // Should have entries for all SYNC_TABLES
    for (const table of SYNC_TABLES) {
      expect(body.changes[table]).toBeDefined();
      expect(body.changes[table]).toHaveProperty("upserted");
      expect(body.changes[table]).toHaveProperty("deleted");
      expect(body.changes[table]).toHaveProperty("hasMore");
    }

    // Our created list and item should be present
    const listIds = body.changes.lists.upserted.map((r: any) => r.id);
    expect(listIds).toContain(listId);
    const itemIds = body.changes.items.upserted.map((r: any) => r.id);
    expect(itemIds).toContain(itemId);
  });

  it("returns only records belonging to the authenticated user (IDOR protection)", async () => {
    // Create a second user with their own data
    const otherUser = await createTestUser("Other Sync User");
    clearAllRateLimits();

    const otherListRes = await authRequest("/lists", otherUser.token, {
      method: "POST",
      body: JSON.stringify({ name: "Other List", colorClass: "bg-red-500" }),
    });
    const otherListId = ((await otherListRes.json()) as any).id;

    clearAllRateLimits();

    // Pull as original user — should NOT see other user's list
    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, cursors: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    const listIds = body.changes.lists.upserted.map((r: any) => r.id);
    expect(listIds).not.toContain(otherListId);
    expect(listIds).toContain(listId);
  });

  it("incremental pull returns only records updated after cursor", async () => {
    clearAllRateLimits();

    // First do a full pull to get cursors
    const fullRes = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, cursors: {} }),
    });
    const fullBody = (await fullRes.json()) as any;
    const cursors = fullBody.cursors;

    // Create a new item AFTER the cursor
    const newItemRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "After Cursor Item", listId }),
    });
    const newItemId = ((await newItemRes.json()) as any).id;

    clearAllRateLimits();

    // Incremental pull with cursors
    const incRes = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, cursors }),
    });
    expect(incRes.status).toBe(200);
    const incBody = (await incRes.json()) as any;

    // The new item should appear in upserted
    const itemIds = incBody.changes.items.upserted.map((r: any) => r.id);
    expect(itemIds).toContain(newItemId);

    // The old item should NOT appear (it hasn't changed since the cursor)
    expect(itemIds).not.toContain(itemId);
  });

  it("returns tombstones for soft-deleted records in the deleted array", async () => {
    clearAllRateLimits();

    // Create an item, then delete it
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "To Be Deleted", listId }),
    });
    const deletedItemId = ((await createRes.json()) as any).id;

    await authRequest(`/things/${deletedItemId}`, token, { method: "DELETE" });

    clearAllRateLimits();

    // Full pull should show the deleted ID in tombstones
    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, cursors: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    expect(body.changes.items.deleted).toContain(deletedItemId);
    // The deleted item should NOT appear in upserted
    const upsertedIds = body.changes.items.upserted.map((r: any) => r.id);
    expect(upsertedIds).not.toContain(deletedItemId);
  });

  it("rejects invalid protocol version (400)", async () => {
    clearAllRateLimits();

    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 99, cursors: {} }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("paginates with limit parameter", async () => {
    clearAllRateLimits();

    // Create several items to test pagination
    for (let i = 0; i < 3; i++) {
      await authRequest("/things", token, {
        method: "POST",
        body: JSON.stringify({ type: "task", title: `Paginate ${i}`, listId }),
      });
    }

    clearAllRateLimits();

    // Pull with limit=2 — should show hasMore for items
    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, cursors: {}, limit: 2 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    // Items should be capped at 2 with hasMore=true
    expect(body.changes.items.upserted.length).toBe(2);
    expect(body.changes.items.hasMore).toBe(true);
  });

  it("unauthenticated request returns 401", async () => {
    const res = await app.request("/sync/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, cursors: {} }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects limit exceeding MAX_LIMIT (400)", async () => {
    clearAllRateLimits();

    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, cursors: {}, limit: 2000 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("detects stale cursor (>30 days) and returns fullSyncRequired", async () => {
    clearAllRateLimits();

    // Use a cursor from 31 days ago
    const staleCursor = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

    const res = await authRequest("/sync/pull", token, {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: 1,
        cursors: { items: staleCursor },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.fullSyncRequired).toBe(true);
  });

  it("excludes calendar events older than 90 days from sync results", async () => {
    clearAllRateLimits();

    const calUser = await createTestUser("Cal Scope User");

    // Create Google account + calendar list fixtures required by CalendarEvent FK constraints
    const googleAccountId = generateId();
    await prisma.googleAccount.create({
      data: {
        id: googleAccountId,
        userId: calUser.userId,
        googleEmail: "scope-test@gmail.com",
        googleUserId: `google-scope-${googleAccountId}`,
        accessToken: encryptToken("fake-access-token"),
        refreshToken: encryptToken("fake-refresh-token"),
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });

    const calendarListId = generateId();
    await prisma.calendarList.create({
      data: {
        id: calendarListId,
        googleAccountId,
        googleCalendarId: "scope-primary",
        name: "Scope Test Calendar",
        color: "#4285f4",
        isVisible: true,
        isPrimary: true,
      },
    });

    // Create an event that is 91 days in the past (outside the 90-day window)
    const oldEventId = generateId();
    const ninetyOneDaysAgo = new Date();
    ninetyOneDaysAgo.setDate(ninetyOneDaysAgo.getDate() - 91);
    await prisma.calendarEvent.create({
      data: {
        id: oldEventId,
        userId: calUser.userId,
        googleAccountId,
        calendarListId,
        googleEventId: `old-event-${oldEventId}`,
        title: "Old Event Outside Window",
        startTime: ninetyOneDaysAgo,
        endTime: new Date(ninetyOneDaysAgo.getTime() + 3600 * 1000),
      },
    });

    // Create a recent event (within the 90-day window) for contrast
    const recentEventId = generateId();
    await prisma.calendarEvent.create({
      data: {
        id: recentEventId,
        userId: calUser.userId,
        googleAccountId,
        calendarListId,
        googleEventId: `recent-event-${recentEventId}`,
        title: "Recent Event Inside Window",
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600 * 1000),
      },
    });

    clearAllRateLimits();

    const res = await authRequest("/sync/pull", calUser.token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, cursors: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    const eventIds = body.changes.calendar_events.upserted.map((e: any) => e.id);
    // The old event must be excluded by the 90-day scope filter
    expect(eventIds).not.toContain(oldEventId);
    // The recent event must be included
    expect(eventIds).toContain(recentEventId);
  });
});

describe("Sync Push", () => {
  let token: string;
  let userId: string;
  let otherToken: string;
  let otherUserId: string;
  const nonce = Date.now().toString(36);

  beforeAll(async () => {
    const user = await createTestUser("Push User");
    token = user.token;
    userId = user.userId;

    const other = await createTestUser("Other Push User");
    otherToken = other.token;
    otherUserId = other.userId;
  });

  function pushRequest(mutations: SyncPushRequest["mutations"], bearerToken = token) {
    return authRequest("/sync/push", bearerToken, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, mutations }),
    });
  }

  it("CREATE: creates a new item via sync push, returns 'applied' + record", async () => {
    clearAllRateLimits();
    const entityId = generateId();
    const idempotencyKey = `create-item-${nonce}-${entityId}`;

    const res = await pushRequest([{
      idempotencyKey,
      entityType: "item",
      entityId,
      action: "CREATE",
      payload: { type: "task", title: "Sync Created Item", status: "active" },
    }]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncPushResponse;
    expect(body.results).toHaveLength(1);
    expect(body.results[0].status).toBe("applied");
    expect(body.results[0].record).toBeDefined();
    expect(body.results[0].record!.id).toBe(entityId);
    expect(body.results[0].record!.title).toBe("Sync Created Item");
    // R7: userId must come from auth context, not payload
    expect(body.results[0].record!.userId).toBe(userId);
    expect(body.serverTime).toBeDefined();
  });

  it("CREATE: idempotency key prevents duplicate creates", async () => {
    clearAllRateLimits();
    const entityId = generateId();
    const idempotencyKey = `idem-create-${nonce}-${entityId}`;

    const mutation = {
      idempotencyKey,
      entityType: "item" as const,
      entityId,
      action: "CREATE" as const,
      payload: { type: "task", title: "Idempotent Item", status: "active" },
    };

    // First push
    const res1 = await pushRequest([mutation]);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as SyncPushResponse;
    expect(body1.results[0].status).toBe("applied");

    clearAllRateLimits();

    // Second push with same idempotency key — should return cached result
    const res2 = await pushRequest([mutation]);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as SyncPushResponse;
    expect(body2.results[0].status).toBe("applied");
    expect(body2.results[0].record!.id).toBe(entityId);

    // Only one record should exist in DB
    const count = await prisma.item.count({ where: { id: entityId } });
    expect(count).toBe(1);
  });

  it("UPDATE (no conflict): field-level merge with non-overlapping fields", async () => {
    clearAllRateLimits();

    // Create an item first via API
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Merge Test", description: "original desc", status: "active" }),
    });
    const created = (await createRes.json()) as any;

    clearAllRateLimits();

    // Push update changing title only — previousValues match server state
    const idempotencyKey = `update-no-conflict-${nonce}-${created.id}`;
    const res = await pushRequest([{
      idempotencyKey,
      entityType: "item",
      entityId: created.id,
      action: "UPDATE",
      payload: { title: "Updated Title" },
      changedFields: ["title"],
      previousValues: { title: "Merge Test" },
      baseUpdatedAt: created.updatedAt,
    }]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncPushResponse;
    expect(body.results[0].status).toBe("applied");
    expect(body.results[0].record!.title).toBe("Updated Title");
    // description unchanged
    expect(body.results[0].record!.description).toBe("original desc");
  });

  it("UPDATE (conflict): overlapping field, server wins", async () => {
    clearAllRateLimits();

    // Create an item
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Conflict Test", status: "active" }),
    });
    const created = (await createRes.json()) as any;

    // Server-side update to change title directly
    await prisma.item.update({
      where: { id: created.id },
      data: { title: "Server Changed Title" },
    });

    clearAllRateLimits();

    // Client tries to update title but previousValues has stale title
    const idempotencyKey = `update-conflict-${nonce}-${created.id}`;
    const res = await pushRequest([{
      idempotencyKey,
      entityType: "item",
      entityId: created.id,
      action: "UPDATE",
      payload: { title: "Client Title" },
      changedFields: ["title"],
      previousValues: { title: "Conflict Test" }, // stale — server changed it
      baseUpdatedAt: created.updatedAt,
    }]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncPushResponse;
    expect(body.results[0].status).toBe("conflict");
    expect(body.results[0].conflictedFields).toContain("title");
    // Server wins — record should have server's title
    expect(body.results[0].record!.title).toBe("Server Changed Title");
  });

  it("UPDATE (partial merge): some fields merge, some conflict", async () => {
    clearAllRateLimits();

    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Partial Merge", description: "orig desc", status: "active" }),
    });
    const created = (await createRes.json()) as any;

    // Server changes only description
    await prisma.item.update({
      where: { id: created.id },
      data: { description: "Server desc" },
    });

    clearAllRateLimits();

    // Client changes both title (clean merge) and description (conflict)
    const idempotencyKey = `update-partial-${nonce}-${created.id}`;
    const res = await pushRequest([{
      idempotencyKey,
      entityType: "item",
      entityId: created.id,
      action: "UPDATE",
      payload: { title: "Client Title", description: "Client desc" },
      changedFields: ["title", "description"],
      previousValues: { title: "Partial Merge", description: "orig desc" },
      baseUpdatedAt: created.updatedAt,
    }]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncPushResponse;
    expect(body.results[0].status).toBe("merged");
    // Title should be client's (no conflict), description should remain server's (conflict)
    expect(body.results[0].record!.title).toBe("Client Title");
    expect(body.results[0].conflictedFields).toContain("description");
    expect(body.results[0].conflictedFields).not.toContain("title");
  });

  it("DELETE: soft-deletes the record", async () => {
    clearAllRateLimits();

    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "To Delete Via Sync", status: "active" }),
    });
    const created = (await createRes.json()) as any;

    clearAllRateLimits();

    const idempotencyKey = `delete-${nonce}-${created.id}`;
    const res = await pushRequest([{
      idempotencyKey,
      entityType: "item",
      entityId: created.id,
      action: "DELETE",
      payload: {},
    }]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncPushResponse;
    expect(body.results[0].status).toBe("applied");

    // Item should be soft-deleted (not found via normal query)
    const found = await prisma.item.findUnique({ where: { id: created.id } });
    expect(found).toBeNull();

    // But still exists when querying with deletedAt bypass
    const tombstone = await prisma.item.findFirst({
      where: { id: created.id, deletedAt: { not: null } },
    });
    expect(tombstone).not.toBeNull();
  });

  it("IDOR: mutation targeting another user's item returns 'not_found'", async () => {
    clearAllRateLimits();

    // Create item as other user
    const createRes = await authRequest("/things", otherToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Other User Item", status: "active" }),
    });
    const otherItem = (await createRes.json()) as any;

    clearAllRateLimits();

    // Try to update as our user
    const idempotencyKey = `idor-update-${nonce}-${otherItem.id}`;
    const res = await pushRequest([{
      idempotencyKey,
      entityType: "item",
      entityId: otherItem.id,
      action: "UPDATE",
      payload: { title: "Hacked Title" },
      changedFields: ["title"],
      previousValues: { title: "Other User Item" },
    }]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncPushResponse;
    expect(body.results[0].status).toBe("not_found");

    // Verify original item is unchanged
    const original = await prisma.item.findUnique({ where: { id: otherItem.id } });
    expect(original!.title).toBe("Other User Item");
  });

  it("IDOR: delete targeting another user's item returns 'not_found'", async () => {
    clearAllRateLimits();

    const createRes = await authRequest("/things", otherToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Other Delete Target", status: "active" }),
    });
    const otherItem = (await createRes.json()) as any;

    clearAllRateLimits();

    const idempotencyKey = `idor-delete-${nonce}-${otherItem.id}`;
    const res = await pushRequest([{
      idempotencyKey,
      entityType: "item",
      entityId: otherItem.id,
      action: "DELETE",
      payload: {},
    }]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncPushResponse;
    expect(body.results[0].status).toBe("not_found");
  });

  it("disallowed entity type returns 'error'", async () => {
    clearAllRateLimits();
    const idempotencyKey = `bad-entity-${nonce}`;

    const res = await pushRequest([{
      idempotencyKey,
      entityType: "scout",
      entityId: generateId(),
      action: "CREATE",
      payload: {},
    }]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncPushResponse;
    expect(body.results[0].status).toBe("error");
    expect(body.results[0].error).toContain("not pushable");
  });

  it("invalid changedFields (e.g. 'userId') returns 'error'", async () => {
    clearAllRateLimits();

    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Field Escalation Test", status: "active" }),
    });
    const created = (await createRes.json()) as any;

    clearAllRateLimits();

    const idempotencyKey = `bad-fields-${nonce}-${created.id}`;
    const res = await pushRequest([{
      idempotencyKey,
      entityType: "item",
      entityId: created.id,
      action: "UPDATE",
      payload: { userId: "hacker-id" },
      changedFields: ["userId"],
      previousValues: { userId },
    }]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncPushResponse;
    expect(body.results[0].status).toBe("error");
    expect(body.results[0].error).toContain("Fields not mutable");
    expect(body.results[0].error).toContain("userId");
  });

  it("max mutations exceeded returns 400", async () => {
    clearAllRateLimits();

    const mutations = Array.from({ length: 51 }, (_, i) => ({
      idempotencyKey: `overflow-${nonce}-${i}`,
      entityType: "item",
      entityId: generateId(),
      action: "CREATE" as const,
      payload: { type: "task", title: `Overflow ${i}`, status: "active" },
    }));

    const res = await authRequest("/sync/push", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 1, mutations }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toContain("Too many mutations");
  });

  it("body size limit returns 413", async () => {
    clearAllRateLimits();

    const res = await authRequest("/sync/push", token, {
      method: "POST",
      headers: { "Content-Length": "2000000" }, // 2MB
      body: JSON.stringify({ protocolVersion: 1, mutations: [] }),
    });

    expect(res.status).toBe(413);
  });

  it("invalid protocol version returns 400", async () => {
    clearAllRateLimits();

    const res = await authRequest("/sync/push", token, {
      method: "POST",
      body: JSON.stringify({ protocolVersion: 99, mutations: [] }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toContain("protocol version");
  });

  it("unauthenticated request returns 401", async () => {
    const res = await app.request("/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, mutations: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("CREATE: list entity type works", async () => {
    clearAllRateLimits();
    const entityId = generateId();
    const idempotencyKey = `create-list-${nonce}-${entityId}`;

    const res = await pushRequest([{
      idempotencyKey,
      entityType: "list",
      entityId,
      action: "CREATE",
      payload: { name: "Sync List", colorClass: "bg-green-500", sortOrder: 0 },
    }]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncPushResponse;
    expect(body.results[0].status).toBe("applied");
    expect(body.results[0].record!.name).toBe("Sync List");
    expect(body.results[0].record!.userId).toBe(userId);
  });
});
