import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { requireSecret } from "../middleware/scout-secret.js";

const adminScoutsRouter = new Hono();

// Auth middleware: use ADMIN_SECRET (falling back to SCOUT_TICK_SECRET if not set)
adminScoutsRouter.use("*", async (c, next) => {
  const envVar = process.env.ADMIN_SECRET ? "ADMIN_SECRET" : "SCOUT_TICK_SECRET";
  return requireSecret(envVar)(c, next);
});

// GET /admin/scouts/stats — global stats for the current calendar month (UTC)
adminScoutsRouter.get("/stats", async (c) => {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [activeScouts, totalRuns, failedRuns, totalFindings] = await Promise.all([
    prisma.scout.count({ where: { status: "active" } }),
    prisma.scoutRun.count({ where: { status: "success", createdAt: { gte: startOfMonth } } }),
    prisma.scoutRun.count({ where: { status: "failed", createdAt: { gte: startOfMonth } } }),
    prisma.scoutFinding.count({ where: { createdAt: { gte: startOfMonth } } }),
  ]);

  const totalAttempts = totalRuns + failedRuns;
  const errorRate = totalAttempts > 0 ? failedRuns / totalAttempts : 0;

  return c.json({
    activeScouts,
    totalRunsThisMonth: totalRuns,
    failedRunsThisMonth: failedRuns,
    totalFindingsThisMonth: totalFindings,
    errorRate,
  });
});

// POST /admin/scouts/pause-all — emergency kill switch: pause all active scouts
adminScoutsRouter.post("/pause-all", async (c) => {
  // Only pause active scouts (skip already-paused ones)
  const activeScouts = await prisma.scout.findMany({
    where: { status: "active" },
    select: { id: true },
  });

  if (activeScouts.length === 0) {
    return c.json({ ok: true, paused: 0 });
  }

  const activeIds = activeScouts.map((s) => s.id);

  await prisma.scout.updateMany({
    where: { id: { in: activeIds } },
    data: { status: "paused" },
  });

  // Log kill switch activity for each paused scout (for resume-all to identify)
  await prisma.scoutActivity.createMany({
    data: activeIds.map((scoutId) => ({
      scoutId,
      type: "paused" as const,
      description: "Scout paused by admin kill switch",
    })),
  });

  console.log(`[admin-scouts] pause-all: paused ${activeIds.length} active scout(s)`);

  return c.json({ ok: true, paused: activeIds.length });
});

// POST /admin/scouts/resume-all — lift kill switch: resume only scouts paused by kill switch
adminScoutsRouter.post("/resume-all", async (c) => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Find scouts that were paused by the kill switch (activity within the last hour)
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

  if (scoutIds.length === 0) {
    return c.json({ ok: true, resumed: 0 });
  }

  const result = await prisma.scout.updateMany({
    where: { id: { in: scoutIds }, status: "paused" },
    data: { status: "active", nextRunAt: now },
  });

  console.log(`[admin-scouts] resume-all: resumed ${result.count} paused scout(s)`);

  return c.json({ ok: true, resumed: result.count });
});

// GET /admin/scouts/runs — most recent 50 runs across all users
adminScoutsRouter.get("/runs", async (c) => {
  const runs = await prisma.scoutRun.findMany({
    take: 50,
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
      scout: {
        select: {
          name: true,
          userId: true,
        },
      },
    },
  });

  return c.json({ runs });
});

export { adminScoutsRouter };
