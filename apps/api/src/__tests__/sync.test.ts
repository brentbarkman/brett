import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/encryption.js";
import { clearAllRateLimits } from "../middleware/rate-limit.js";
import { SYNC_TABLES } from "@brett/types";
import { generateId } from "@brett/utils";

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
