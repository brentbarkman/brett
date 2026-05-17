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

  describe("GET /brett/briefing/current", () => {
    it("returns null + dirty when no briefing row exists", async () => {
      // Clean slate — make sure no row for this user.
      await prisma.userBriefing.deleteMany({ where: { userId } });

      const res = await authRequest("/brett/briefing/current", token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.briefing).toBeNull();
      expect(body.staleness).toBe("dirty");
    });

    it("returns the cached briefing row + fresh staleness", async () => {
      // Upsert a recent, clean briefing row.
      await prisma.userBriefing.upsert({
        where: { userId },
        create: {
          userId,
          content: "Quiet morning. Nothing moved overnight.",
          isEmpty: false,
          signalsUsedIds: [],
          generatedAt: new Date(),
          dirtyAt: null,
          regenCountToday: 1,
          regenDayKey: "2026-05-16",
        },
        update: {
          content: "Quiet morning. Nothing moved overnight.",
          isEmpty: false,
          generatedAt: new Date(),
          dirtyAt: null,
        },
      });

      const res = await authRequest("/brett/briefing/current", token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.briefing).not.toBeNull();
      expect(body.briefing.content).toBe(
        "Quiet morning. Nothing moved overnight.",
      );
      expect(body.briefing.isEmpty).toBe(false);
      expect(body.staleness).toBe("fresh");
    });

    it("reports dirty staleness when dirtyAt > generatedAt and outside 30min floor", async () => {
      const generatedAt = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
      const dirtyAt = new Date(Date.now() - 5 * 60 * 1000); // 5m ago
      await prisma.userBriefing.upsert({
        where: { userId },
        create: {
          userId,
          content: "Hour-old briefing.",
          isEmpty: false,
          signalsUsedIds: [],
          generatedAt,
          dirtyAt,
          regenCountToday: 1,
          regenDayKey: "2026-05-16",
        },
        update: { generatedAt, dirtyAt, regenCountToday: 1 },
      });

      const res = await authRequest("/brett/briefing/current", token);
      const body = (await res.json()) as any;
      expect(body.staleness).toBe("dirty");
    });

    it("reports capped staleness when the daily ceiling is hit", async () => {
      await prisma.userBriefing.upsert({
        where: { userId },
        create: {
          userId,
          content: "At the daily ceiling.",
          isEmpty: false,
          signalsUsedIds: [],
          generatedAt: new Date(Date.now() - 60 * 60 * 1000),
          dirtyAt: new Date(),
          regenCountToday: 6, // === ceiling
          regenDayKey: "2026-05-16",
        },
        update: {
          regenCountToday: 6,
          dirtyAt: new Date(),
          generatedAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      });

      const res = await authRequest("/brett/briefing/current", token);
      const body = (await res.json()) as any;
      expect(body.staleness).toBe("capped");
    });

    it("requires authentication", async () => {
      const res = await authRequest("/brett/briefing/current", "invalid-token");
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

    it("rejects missing auto field", async () => {
      const res = await authRequest("/users/timezone", token, {
        method: "PATCH",
        body: JSON.stringify({ timezone: "America/New_York" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toContain("auto is required");
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
