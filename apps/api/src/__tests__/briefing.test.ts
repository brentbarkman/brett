import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

describe("Briefing routes", () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser("Briefing User");
    token = user.token;
    userId = user.userId;
  });

  describe("GET /brett/briefing", () => {
    it("returns null when no briefing exists", async () => {
      const res = await authRequest("/brett/briefing", token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.briefing).toBeNull();
    });

    it("returns cached briefing from today", async () => {
      const session = await prisma.conversationSession.create({
        data: {
          userId,
          source: "briefing",
          modelTier: "medium",
          modelUsed: "test",
        },
      });
      await prisma.conversationMessage.create({
        data: {
          sessionId: session.id,
          role: "assistant",
          content: "Test briefing content",
        },
      });

      const res = await authRequest("/brett/briefing", token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.briefing).not.toBeNull();
      expect(body.briefing.content).toBe("Test briefing content");
      expect(body.briefing.sessionId).toBe(session.id);
    });

    it("requires authentication", async () => {
      const res = await authRequest("/brett/briefing", "invalid-token");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /brett/briefing/summary", () => {
    it("returns counts structure", async () => {
      const res = await authRequest("/brett/briefing/summary", token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(typeof body.overdueTasks).toBe("number");
      expect(typeof body.dueTodayTasks).toBe("number");
      expect(typeof body.todayEvents).toBe("number");
      expect(Array.isArray(body.overdueItems)).toBe(true);
    });

    it("returns correct counts with seeded data", async () => {
      // Create a list for the seeded item
      const listRes = await authRequest("/lists", token, {
        method: "POST",
        body: JSON.stringify({ name: "Briefing Test List", colorClass: "bg-red-500" }),
      });
      const list = (await listRes.json()) as any;

      await prisma.item.create({
        data: {
          userId,
          type: "task",
          status: "active",
          title: "Overdue briefing task",
          source: "Brett",
          dueDate: new Date("2020-01-01"),
          listId: list.id,
        },
      });

      const res = await authRequest("/brett/briefing/summary", token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.overdueTasks).toBeGreaterThanOrEqual(1);
      expect(body.overdueItems.length).toBeGreaterThanOrEqual(1);
      expect(body.overdueItems[0].title).toBeDefined();
      expect(body.overdueItems[0].dueDate).toBeDefined();
    });

    it("requires authentication", async () => {
      const res = await authRequest("/brett/briefing/summary", "invalid-token");
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /users/timezone", () => {
    it("updates timezone with valid IANA string", async () => {
      const res = await authRequest("/users/timezone", token, {
        method: "PATCH",
        body: JSON.stringify({ timezone: "America/New_York", auto: false }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.timezone).toBe("America/New_York");
      expect(body.timezoneAuto).toBe(false);
    });

    it("rejects invalid timezone string", async () => {
      const res = await authRequest("/users/timezone", token, {
        method: "PATCH",
        body: JSON.stringify({ timezone: "Not/A/Timezone", auto: true }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects empty timezone", async () => {
      const res = await authRequest("/users/timezone", token, {
        method: "PATCH",
        body: JSON.stringify({ timezone: "", auto: true }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects non-boolean auto field", async () => {
      const res = await authRequest("/users/timezone", token, {
        method: "PATCH",
        body: JSON.stringify({ timezone: "UTC", auto: "yes" }),
      });
      expect(res.status).toBe(400);
    });

    it("handles malformed JSON body", async () => {
      const res = await app.request("/users/timezone", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    it("persists timezone to user record", async () => {
      await authRequest("/users/timezone", token, {
        method: "PATCH",
        body: JSON.stringify({ timezone: "Asia/Tokyo", auto: true }),
      });

      const meRes = await authRequest("/users/me", token);
      const me = (await meRes.json()) as any;
      expect(me.timezone).toBe("Asia/Tokyo");
      expect(me.timezoneAuto).toBe(true);
    });

    it("requires authentication", async () => {
      const res = await authRequest("/users/timezone", "invalid-token", {
        method: "PATCH",
        body: JSON.stringify({ timezone: "UTC", auto: true }),
      });
      expect(res.status).toBe(401);
    });
  });
});
