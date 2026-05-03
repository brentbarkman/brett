import { describe, it, expect, beforeAll, vi } from "vitest";

// Stub findSimilarItems so we can pretend any item we created is "similar"
// to the test event without populating the Embedding table. Everything else
// from @brett/ai (AI_CONFIG, classifyMatches, etc.) keeps real behavior so
// the route's threshold filter still runs.
vi.mock("@brett/ai", async () => {
  const actual = await vi.importActual<typeof import("@brett/ai")>("@brett/ai");
  return { ...actual, findSimilarItems: vi.fn() };
});

import { findSimilarItems } from "@brett/ai";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/encryption.js";
import { generateId } from "@brett/utils";

process.env.CALENDAR_TOKEN_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const mockedFindSimilar = findSimilarItems as unknown as ReturnType<typeof vi.fn>;

describe("Suggestions routes", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Suggestions User");
    token = user.token;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/api/things/nonexistent/suggestions");
    expect(res.status).toBe(401);
  });

  it("GET /api/things/:id/suggestions returns 404 for unknown item", async () => {
    const res = await authRequest("/api/things/nonexistent/suggestions", token);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/events/:id/related-items — recency filter", () => {
  let token: string;
  let userId: string;
  let eventId: string;

  // Item ids by role in the test
  let recentDueId: string;       // dueDate within window → keep
  let futureDueId: string;       // dueDate in the future → keep
  let oldDueId: string;          // dueDate older than 90d → drop
  let recentNoDueId: string;     // dueDate null, createdAt within window → keep
  let oldNoDueId: string;        // dueDate null, createdAt older than 90d → drop

  const DAY = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    const user = await createTestUser("Recency Filter User");
    token = user.token;
    userId = user.userId;

    const googleAccountId = generateId();
    await prisma.googleAccount.create({
      data: {
        id: googleAccountId,
        userId,
        googleEmail: "recency@gmail.com",
        googleUserId: "google-recency",
        accessToken: encryptToken("fake-access"),
        refreshToken: encryptToken("fake-refresh"),
        tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
      },
    });

    const calendarListId = generateId();
    await prisma.calendarList.create({
      data: {
        id: calendarListId,
        googleAccountId,
        googleCalendarId: "primary",
        name: "Recency Calendar",
        color: "#4285f4",
        isVisible: true,
        isPrimary: true,
      },
    });

    eventId = generateId();
    await prisma.calendarEvent.create({
      data: {
        id: eventId,
        userId,
        googleAccountId,
        calendarListId,
        googleEventId: "google-event-recency",
        title: "Quarterly review",
        startTime: new Date(),
        endTime: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const now = Date.now();
    const recently = new Date(now - 10 * DAY);
    const longAgo = new Date(now - 200 * DAY);
    const future = new Date(now + 14 * DAY);

    recentDueId = generateId();
    futureDueId = generateId();
    oldDueId = generateId();
    recentNoDueId = generateId();
    oldNoDueId = generateId();

    await prisma.item.createMany({
      data: [
        {
          id: recentDueId,
          userId,
          type: "task",
          title: "Recent due",
          dueDate: recently,
          // createdAt explicitly old to prove dueDate wins
          createdAt: longAgo,
        },
        {
          id: futureDueId,
          userId,
          type: "task",
          title: "Future due",
          dueDate: future,
          createdAt: longAgo,
        },
        {
          id: oldDueId,
          userId,
          type: "task",
          title: "Old due",
          dueDate: longAgo,
          createdAt: recently, // recent createdAt must NOT rescue an old dueDate
        },
        {
          id: recentNoDueId,
          userId,
          type: "task",
          title: "No due, recent createdAt",
          createdAt: recently,
        },
        {
          id: oldNoDueId,
          userId,
          type: "task",
          title: "No due, old createdAt",
          createdAt: longAgo,
        },
      ],
    });

    mockedFindSimilar.mockReset();
    mockedFindSimilar.mockResolvedValue([
      { entityId: recentDueId, similarity: 0.9 },
      { entityId: futureDueId, similarity: 0.88 },
      { entityId: oldDueId, similarity: 0.86 },
      { entityId: recentNoDueId, similarity: 0.84 },
      { entityId: oldNoDueId, similarity: 0.82 },
    ]);
  });

  it("includes items with a recent or future dueDate, or recent createdAt when dueDate is null", async () => {
    const res = await authRequest(`/api/events/${eventId}/related-items`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { relatedItems: Array<{ entityId: string }> };

    const ids = body.relatedItems.map((i) => i.entityId).sort();
    expect(ids).toEqual([recentDueId, futureDueId, recentNoDueId].sort());
  });

  it("excludes items whose dueDate is older than 90d, even if createdAt is recent", async () => {
    const res = await authRequest(`/api/events/${eventId}/related-items`, token);
    const body = (await res.json()) as { relatedItems: Array<{ entityId: string }> };
    const ids = body.relatedItems.map((i) => i.entityId);
    expect(ids).not.toContain(oldDueId);
  });

  it("excludes items with no dueDate and an old createdAt", async () => {
    const res = await authRequest(`/api/events/${eventId}/related-items`, token);
    const body = (await res.json()) as { relatedItems: Array<{ entityId: string }> };
    const ids = body.relatedItems.map((i) => i.entityId);
    expect(ids).not.toContain(oldNoDueId);
  });
});
