import crypto from "node:crypto";
import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";

const adminScoutsRouter = new Hono();

// Auth middleware: all routes require valid SCOUT_TICK_SECRET header
adminScoutsRouter.use("*", async (c, next) => {
  const secret = c.req.header("x-scout-secret") ?? "";
  const expected = process.env.SCOUT_TICK_SECRET ?? "";

  if (!expected || secret.length !== expected.length) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    if (!crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
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
  const result = await prisma.scout.updateMany({
    where: { status: "active" },
    data: { status: "paused" },
  });

  console.log(`[admin-scouts] pause-all: paused ${result.count} active scout(s)`);

  return c.json({ ok: true, paused: result.count });
});

// POST /admin/scouts/resume-all — lift kill switch: resume all paused scouts
adminScoutsRouter.post("/resume-all", async (c) => {
  const now = new Date();

  const result = await prisma.scout.updateMany({
    where: { status: "paused" },
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
