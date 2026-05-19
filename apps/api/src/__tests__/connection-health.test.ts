import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../lib/prisma.js";
import {
  createRelinkTask,
  resolveRelinkTask,
  resolveRelinkTaskForAccount,
  getBrokenConnections,
} from "../lib/connection-health.js";
import { generateId } from "@brett/utils";

describe("connection-health", () => {
  let userId: string;

  beforeAll(async () => {
    // Create a user directly via Prisma (avoids better-auth schema issues in test DB)
    const user = await prisma.user.create({
      data: {
        id: generateId(),
        name: "Connection Health User",
        email: `conn-health-${Date.now()}@test.com`,
        emailVerified: true,
      },
    });
    userId = user.id;
  });

  const findRelinkTasks = (uid: string, sourceIdPrefix: string) =>
    prisma.item.findMany({
      where: { userId: uid, source: "system", sourceId: { startsWith: sourceIdPrefix } },
      orderBy: { createdAt: "desc" },
    });

  describe("createRelinkTask", () => {
    it("creates a task with correct fields", async () => {
      await createRelinkTask(userId, "google-calendar", "acc-1", "Token expired");

      const tasks = await findRelinkTasks(userId, "relink:google-calendar:");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        type: "task",
        title: "Re-link Google Calendar",
        notes: "Token expired",
        source: "system",
        sourceId: "relink:google-calendar:acc-1",
        status: "active",
        dueDatePrecision: "day",
      });
      expect(tasks[0]!.dueDate).toBeTruthy();
    });

    it("deduplicates — skips if active task already exists", async () => {
      await createRelinkTask(userId, "google-calendar", "acc-1", "Token expired again");

      const tasks = await findRelinkTasks(userId, "relink:google-calendar:");
      expect(tasks).toHaveLength(1);
    });

    it("creates a new task after previous one is completed", async () => {
      await prisma.item.updateMany({
        where: { userId, source: "system", sourceId: "relink:google-calendar:acc-1" },
        data: { status: "done", completedAt: new Date() },
      });

      await createRelinkTask(userId, "google-calendar", "acc-1", "Broke again");

      const tasks = await findRelinkTasks(userId, "relink:google-calendar:");
      const active = tasks.filter((t) => t.status === "active");
      expect(active).toHaveLength(1);
      expect(active[0]!.notes).toBe("Broke again");
    });

    it("creates separate tasks for different connection types", async () => {
      await createRelinkTask(userId, "granola", "gran-1", "Granola broke");
      await createRelinkTask(userId, "ai", "key-1", "AI key invalid");

      const granola = await findRelinkTasks(userId, "relink:granola:");
      const ai = await findRelinkTasks(userId, "relink:ai:");
      expect(granola).toHaveLength(1);
      expect(ai).toHaveLength(1);
    });
  });

  describe("resolveRelinkTask", () => {
    it("marks active re-link tasks as done", async () => {
      const before = await findRelinkTasks(userId, "relink:granola:");
      expect(before.some((t) => t.status === "active")).toBe(true);

      await resolveRelinkTask(userId, "granola");

      const after = await findRelinkTasks(userId, "relink:granola:");
      const active = after.filter((t) => t.status === "active");
      expect(active).toHaveLength(0);
    });

    it("is a no-op when no active tasks exist", async () => {
      await resolveRelinkTask(userId, "granola");
    });

    it("resolves tasks across different accountIds via prefix matching", async () => {
      await createRelinkTask(userId, "ai", "key-old", "Old key broke");
      await prisma.item.updateMany({
        where: { userId, source: "system", sourceId: "relink:ai:key-1", status: "active" },
        data: { status: "done", completedAt: new Date() },
      });
      await createRelinkTask(userId, "ai", "key-new", "New key also broke");

      const before = await findRelinkTasks(userId, "relink:ai:");
      const activeBefore = before.filter((t) => t.status === "active");
      expect(activeBefore.length).toBeGreaterThanOrEqual(1);

      await resolveRelinkTask(userId, "ai");

      const after = await findRelinkTasks(userId, "relink:ai:");
      const activeAfter = after.filter((t) => t.status === "active");
      expect(activeAfter).toHaveLength(0);
    });
  });

  describe("getBrokenConnections", () => {
    // Each subtest uses a fresh user so per-account counts aren't polluted by
    // the createRelinkTask cases above.
    it("returns details with per-account reason and brokenSince", async () => {
      const user = await prisma.user.create({
        data: {
          id: generateId(),
          name: "Broken Conn User",
          email: `broken-${Date.now()}-${Math.random()}@test.com`,
          emailVerified: true,
        },
      });
      await createRelinkTask(user.id, "granola", "acc-1", "Token expired");

      const result = await getBrokenConnections(user.id);

      expect(result.count).toBe(1);
      expect(result.types).toEqual(["granola"]);
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toMatchObject({
        type: "granola",
        accountId: "acc-1",
        reason: "Token expired",
      });
      expect(result.details[0]!.brokenSince).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("preserves backwards-compatible shape: count + types alongside details", async () => {
      const user = await prisma.user.create({
        data: {
          id: generateId(),
          name: "Multi Type User",
          email: `multi-${Date.now()}-${Math.random()}@test.com`,
          emailVerified: true,
        },
      });
      await createRelinkTask(user.id, "granola", "g1", "Granola broke");
      await createRelinkTask(user.id, "google-calendar", "gc1", "Calendar broke");

      const result = await getBrokenConnections(user.id);

      expect(result.count).toBe(2);
      expect(new Set(result.types)).toEqual(new Set(["granola", "google-calendar"]));
      expect(result.details).toHaveLength(2);
    });

    it("regression: reconnecting account B does not clear account A's re-link task", async () => {
      const user = await prisma.user.create({
        data: {
          id: generateId(),
          name: "Scoped Resolution User",
          email: `scoped-${Date.now()}-${Math.random()}@test.com`,
          emailVerified: true,
        },
      });
      await createRelinkTask(user.id, "granola", "acc-A", "Token expired for A");
      await createRelinkTask(user.id, "granola", "acc-B", "Token expired for B");

      // Simulate reconnect of acc-B
      await resolveRelinkTaskForAccount(user.id, "granola", "acc-B");

      const result = await getBrokenConnections(user.id);
      expect(result.details).toHaveLength(1);
      expect(result.details[0]!.accountId).toBe("acc-A");
      expect(result.details[0]!.reason).toBe("Token expired for A");
    });
  });
});
