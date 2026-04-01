import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";

export const scouts = new Hono<AuthEnv>();

scouts.get("/", async (c) => {
  const status = c.req.query("status");
  const where = status ? { status: status as any } : {};

  const scoutList = await prisma.scout.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      status: true,
      goal: true,
      cadenceIntervalHours: true,
      nextRunAt: true,
      createdAt: true,
      userId: true,
      user: { select: { email: true, name: true } },
      _count: { select: { runs: true, findings: true } },
    },
  });

  return c.json({ scouts: scoutList });
});

scouts.get("/runs", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 50));

  const runs = await prisma.scoutRun.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      scoutId: true,
      createdAt: true,
      status: true,
      resultCount: true,
      findingsCount: true,
      tokensUsed: true,
      durationMs: true,
      error: true,
      scout: { select: { name: true, userId: true } },
    },
  });

  return c.json({ runs });
});

scouts.get("/:id", async (c) => {
  const scoutId = c.req.param("id");

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    include: {
      user: { select: { email: true, name: true } },
      runs: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          status: true,
          findingsCount: true,
          tokensUsed: true,
          durationMs: true,
          error: true,
        },
      },
      findings: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          type: true,
          title: true,
          relevanceScore: true,
          feedbackUseful: true,
        },
      },
      _count: { select: { runs: true, findings: true, memories: true } },
    },
  });

  if (!scout) return c.json({ error: "Scout not found" }, 404);
  return c.json({ scout });
});

scouts.post("/:id/pause", async (c) => {
  const scoutId = c.req.param("id");

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { id: true, status: true },
  });

  if (!scout) return c.json({ error: "Scout not found" }, 404);
  if (scout.status !== "active") return c.json({ error: "Scout is not active" }, 400);

  await prisma.scout.update({
    where: { id: scoutId },
    data: { status: "paused" },
  });

  await prisma.scoutActivity.create({
    data: { scoutId, type: "paused", description: "Scout paused by admin" },
  });

  return c.json({ ok: true });
});

scouts.post("/:id/resume", async (c) => {
  const scoutId = c.req.param("id");

  const scout = await prisma.scout.findUnique({
    where: { id: scoutId },
    select: { id: true, status: true },
  });

  if (!scout) return c.json({ error: "Scout not found" }, 404);
  if (scout.status !== "paused") return c.json({ error: "Scout is not paused" }, 400);

  await prisma.scout.update({
    where: { id: scoutId },
    data: { status: "active", nextRunAt: new Date() },
  });

  await prisma.scoutActivity.create({
    data: { scoutId, type: "resumed", description: "Scout resumed by admin" },
  });

  return c.json({ ok: true });
});

scouts.post("/pause-all", async (c) => {
  const activeScouts = await prisma.scout.findMany({
    where: { status: "active" },
    select: { id: true },
  });

  if (activeScouts.length === 0) return c.json({ ok: true, paused: 0 });

  const activeIds = activeScouts.map((s) => s.id);

  await prisma.scout.updateMany({
    where: { id: { in: activeIds } },
    data: { status: "paused" },
  });

  await prisma.scoutActivity.createMany({
    data: activeIds.map((scoutId) => ({
      scoutId,
      type: "paused" as const,
      description: "Scout paused by admin kill switch",
    })),
  });

  return c.json({ ok: true, paused: activeIds.length });
});

scouts.post("/resume-all", async (c) => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const killSwitchActivities = await prisma.scoutActivity.findMany({
    where: {
      type: "paused",
      description: { contains: "kill switch" },
      createdAt: { gte: oneHourAgo },
    },
    select: { scoutId: true },
    distinct: ["scoutId"],
  });

  const scoutIds = killSwitchActivities.map((a) => a.scoutId);
  if (scoutIds.length === 0) return c.json({ ok: true, resumed: 0 });

  const result = await prisma.scout.updateMany({
    where: { id: { in: scoutIds }, status: "paused" },
    data: { status: "active", nextRunAt: now },
  });

  return c.json({ ok: true, resumed: result.count });
});
