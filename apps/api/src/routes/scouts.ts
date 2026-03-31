import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { publishSSE } from "../lib/sse.js";
import type { Scout, ScoutSource, CreateScoutInput, ScoutFinding, ActivityEntry, ScoutBudgetSummary, ScoutRunStatus, ScoutActivityType } from "@brett/types";

const scouts = new Hono<AuthEnv>();

// All routes require auth
scouts.use("*", authMiddleware);

function serializeScout(scout: any, extras?: { findingsCount?: number; lastRun?: string }): Scout {
  return {
    id: scout.id,
    name: scout.name,
    avatarLetter: scout.avatarLetter,
    avatarGradient: [scout.avatarGradientFrom, scout.avatarGradientTo],
    goal: scout.goal,
    context: scout.context ?? undefined,
    sources: scout.sources as ScoutSource[],
    sensitivity: scout.sensitivity,
    cadenceIntervalHours: scout.cadenceIntervalHours,
    cadenceMinIntervalHours: scout.cadenceMinIntervalHours,
    cadenceCurrentIntervalHours: scout.cadenceCurrentIntervalHours,
    cadenceReason: scout.cadenceReason ?? undefined,
    budgetUsed: scout.budgetUsed,
    budgetTotal: scout.budgetTotal,
    status: scout.status,
    statusLine: scout.statusLine ?? undefined,
    endDate: scout.endDate?.toISOString() ?? undefined,
    nextRunAt: scout.nextRunAt?.toISOString() ?? undefined,
    lastRun: extras?.lastRun ?? undefined,
    findingsCount: extras?.findingsCount ?? 0,
    createdAt: scout.createdAt.toISOString(),
  };
}

function startOfNextMonth(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// GET /scouts — list user's scouts
scouts.get("/", async (c) => {
  const user = c.get("user");
  const { status } = c.req.query();

  const where: Record<string, unknown> = { userId: user.id };
  if (status === "all") {
    // no status filter
  } else if (["active", "paused", "completed", "expired"].includes(status ?? "")) {
    where.status = status;
  } else {
    where.status = { not: "completed" }; // default
  }

  const rows = await prisma.scout.findMany({
    where,
    include: {
      _count: { select: { findings: { where: { dismissed: false } } } },
      runs: { take: 1, orderBy: { createdAt: "desc" }, select: { createdAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return c.json(
    rows.map((row) =>
      serializeScout(row, {
        findingsCount: row._count.findings,
        lastRun: row.runs[0]?.createdAt.toISOString(),
      })
    )
  );
});

// POST /scouts — create scout
scouts.post("/", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json()) as CreateScoutInput;

  // Required field validation
  const required: Array<keyof CreateScoutInput> = [
    "name",
    "goal",
    "avatarLetter",
    "avatarGradientFrom",
    "avatarGradientTo",
    "sources",
    "cadenceIntervalHours",
    "cadenceMinIntervalHours",
    "budgetTotal",
  ];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return c.json({ error: `Missing required field: ${field}` }, 400);
    }
  }

  // Length validation
  if (typeof body.name === "string" && body.name.length > 100) {
    return c.json({ error: "name must be 100 characters or fewer" }, 400);
  }
  if (typeof body.goal === "string" && body.goal.length > 5000) {
    return c.json({ error: "goal must be 5000 characters or fewer" }, 400);
  }
  if (typeof body.context === "string" && body.context.length > 5000) {
    return c.json({ error: "context must be 5000 characters or fewer" }, 400);
  }

  // Cadence minimum
  if (body.cadenceMinIntervalHours < 0.25) {
    return c.json({ error: "cadenceMinIntervalHours must be at least 0.25 (15 minutes)" }, 400);
  }

  // Max 20 active scouts per user
  const activeCount = await prisma.scout.count({
    where: { userId: user.id, status: { not: "completed" } },
  });
  if (activeCount >= 20) {
    return c.json({ error: "Maximum of 20 active scouts allowed" }, 400);
  }

  const nextRunAt = new Date(Date.now() + body.cadenceIntervalHours * 3600000);
  const budgetResetAt = startOfNextMonth();

  const created = await prisma.scout.create({
    data: {
      userId: user.id,
      name: body.name,
      avatarLetter: body.avatarLetter,
      avatarGradientFrom: body.avatarGradientFrom,
      avatarGradientTo: body.avatarGradientTo,
      goal: body.goal,
      context: body.context ?? null,
      sources: body.sources as unknown as Prisma.InputJsonValue,
      sensitivity: body.sensitivity ?? "medium",
      cadenceIntervalHours: body.cadenceIntervalHours,
      cadenceMinIntervalHours: body.cadenceMinIntervalHours,
      cadenceCurrentIntervalHours: body.cadenceIntervalHours,
      budgetTotal: body.budgetTotal,
      budgetResetAt,
      nextRunAt,
      endDate: body.endDate ? new Date(body.endDate) : null,
      conversationSessionId: body.conversationSessionId ?? null,
      activity: {
        create: {
          type: "created",
          description: "Scout created",
        },
      },
    },
  });

  publishSSE(user.id, { type: "scout.status.changed", payload: { scoutId: created.id, status: created.status } });

  return c.json(serializeScout(created, { findingsCount: 0 }), 201);
});

// GET /scouts/budget — budget summary for user's scouts (must be before /:id)
scouts.get("/budget", async (c) => {
  const user = c.get("user");

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const userScouts = await prisma.scout.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, budgetUsed: true, budgetTotal: true },
  });

  const scoutIds = userScouts.map((s) => s.id);

  const runsThisMonth = await prisma.scoutRun.findMany({
    where: {
      scoutId: { in: scoutIds },
      status: "success",
      createdAt: { gte: startOfMonth },
    },
    select: { scoutId: true },
  });

  const summary: ScoutBudgetSummary = {
    totalRunsThisMonth: runsThisMonth.length,
    scouts: userScouts.map((s) => ({
      id: s.id,
      name: s.name,
      budgetUsed: s.budgetUsed,
      budgetTotal: s.budgetTotal,
    })),
  };

  return c.json(summary);
});

// GET /scouts/:id — scout detail
scouts.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const scout = await prisma.scout.findFirst({
    where: { id, userId: user.id },
    include: {
      _count: { select: { findings: { where: { dismissed: false } } } },
      runs: { take: 1, orderBy: { createdAt: "desc" }, select: { createdAt: true } },
    },
  });

  if (!scout) return c.json({ error: "Not found" }, 404);

  return c.json(
    serializeScout(scout, {
      findingsCount: scout._count.findings,
      lastRun: scout.runs[0]?.createdAt.toISOString(),
    })
  );
});

// PUT /scouts/:id — update scout
scouts.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json();

  const existing = await prisma.scout.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  // Validate provided fields
  if (body.name !== undefined && typeof body.name === "string" && body.name.length > 100) {
    return c.json({ error: "name must be 100 characters or fewer" }, 400);
  }
  if (body.goal !== undefined && typeof body.goal === "string" && body.goal.length > 5000) {
    return c.json({ error: "goal must be 5000 characters or fewer" }, 400);
  }
  if (body.context !== undefined && typeof body.context === "string" && body.context.length > 5000) {
    return c.json({ error: "context must be 5000 characters or fewer" }, 400);
  }
  if (body.cadenceMinIntervalHours !== undefined && body.cadenceMinIntervalHours < 0.25) {
    return c.json({ error: "cadenceMinIntervalHours must be at least 0.25 (15 minutes)" }, 400);
  }
  if (body.cadenceIntervalHours !== undefined && body.cadenceIntervalHours <= 0) {
    return c.json({ error: "cadenceIntervalHours must be positive" }, 400);
  }
  if (body.budgetTotal !== undefined && body.budgetTotal <= 0) {
    return c.json({ error: "budgetTotal must be positive" }, 400);
  }
  if (body.sensitivity !== undefined && !["low", "medium", "high"].includes(body.sensitivity)) {
    return c.json({ error: "sensitivity must be one of: low, medium, high" }, 400);
  }

  // Build update object from provided fields only
  const scoutUpdateData: Prisma.ScoutUpdateInput = {};
  if (body.name !== undefined) scoutUpdateData.name = body.name;
  if (body.goal !== undefined) scoutUpdateData.goal = body.goal;
  if (body.context !== undefined) scoutUpdateData.context = body.context;
  if (body.sources !== undefined) scoutUpdateData.sources = body.sources as unknown as Prisma.InputJsonValue;
  if (body.sensitivity !== undefined) scoutUpdateData.sensitivity = body.sensitivity;
  if (body.cadenceIntervalHours !== undefined) scoutUpdateData.cadenceIntervalHours = body.cadenceIntervalHours;
  if (body.cadenceMinIntervalHours !== undefined) scoutUpdateData.cadenceMinIntervalHours = body.cadenceMinIntervalHours;
  if (body.cadenceCurrentIntervalHours !== undefined) scoutUpdateData.cadenceCurrentIntervalHours = body.cadenceCurrentIntervalHours;
  if (body.cadenceReason !== undefined) scoutUpdateData.cadenceReason = body.cadenceReason;
  if (body.budgetTotal !== undefined) scoutUpdateData.budgetTotal = body.budgetTotal;
  if (body.statusLine !== undefined) scoutUpdateData.statusLine = body.statusLine;
  if (body.endDate !== undefined) scoutUpdateData.endDate = body.endDate ? new Date(body.endDate) : null;

  // Compute before/after diff for activity metadata
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(scoutUpdateData)) {
    before[key] = (existing as Record<string, unknown>)[key];
    after[key] = (scoutUpdateData as Record<string, unknown>)[key];
  }

  const updated = await prisma.scout.update({
    where: { id: existing.id },
    data: {
      ...scoutUpdateData,
      activity: {
        create: {
          type: "config_changed",
          description: "Scout configuration updated",
          metadata: { before, after } as unknown as Prisma.InputJsonValue,
        },
      },
    },
    include: {
      _count: { select: { findings: { where: { dismissed: false } } } },
      runs: { take: 1, orderBy: { createdAt: "desc" }, select: { createdAt: true } },
    },
  });

  publishSSE(user.id, { type: "scout.status.changed", payload: { scoutId: updated.id, status: updated.status } });

  return c.json(
    serializeScout(updated, {
      findingsCount: updated._count.findings,
      lastRun: updated.runs[0]?.createdAt.toISOString(),
    })
  );
});

// DELETE /scouts/:id — soft delete (mark completed)
scouts.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const existing = await prisma.scout.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const updated = await prisma.scout.update({
    where: { id: existing.id },
    data: {
      status: "completed",
      nextRunAt: null,
      activity: {
        create: {
          type: "completed",
          description: "Scout completed",
        },
      },
    },
  });

  publishSSE(user.id, { type: "scout.status.changed", payload: { scoutId: updated.id, status: updated.status } });

  return c.json({ ok: true });
});

// POST /scouts/:id/pause — pause a scout
scouts.post("/:id/pause", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const existing = await prisma.scout.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const updated = await prisma.scout.update({
    where: { id: existing.id },
    data: {
      status: "paused",
      nextRunAt: null,
      activity: {
        create: {
          type: "paused",
          description: "Scout paused by user",
        },
      },
    },
    include: {
      _count: { select: { findings: { where: { dismissed: false } } } },
      runs: { take: 1, orderBy: { createdAt: "desc" }, select: { createdAt: true } },
    },
  });

  publishSSE(user.id, { type: "scout.status.changed", payload: { scoutId: updated.id, status: updated.status } });

  return c.json(
    serializeScout(updated, {
      findingsCount: updated._count.findings,
      lastRun: updated.runs[0]?.createdAt.toISOString(),
    })
  );
});

// POST /scouts/:id/resume — resume a paused scout
scouts.post("/:id/resume", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const existing = await prisma.scout.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const updated = await prisma.scout.update({
    where: { id: existing.id },
    data: {
      status: "active",
      nextRunAt: new Date(),
      activity: {
        create: {
          type: "resumed",
          description: "Scout resumed by user",
        },
      },
    },
    include: {
      _count: { select: { findings: { where: { dismissed: false } } } },
      runs: { take: 1, orderBy: { createdAt: "desc" }, select: { createdAt: true } },
    },
  });

  publishSSE(user.id, { type: "scout.status.changed", payload: { scoutId: updated.id, status: updated.status } });

  return c.json(
    serializeScout(updated, {
      findingsCount: updated._count.findings,
      lastRun: updated.runs[0]?.createdAt.toISOString(),
    })
  );
});

// POST /scouts/:id/run — manually trigger a scout run
scouts.post("/:id/run", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const existing = await prisma.scout.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  // Rate limit: reject if a run is already in progress
  const runningRun = await prisma.scoutRun.findFirst({
    where: { scoutId: id, status: "running" },
  });
  if (runningRun) {
    return c.json({ error: "A run is already in progress for this scout" }, 429);
  }

  // Rate limit: reject if the most recent run was less than 60 seconds ago
  const mostRecentRun = await prisma.scoutRun.findFirst({
    where: { scoutId: id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (mostRecentRun && Date.now() - mostRecentRun.createdAt.getTime() < 60_000) {
    return c.json({ error: "Please wait at least 60 seconds between manual runs" }, 429);
  }

  // Fire-and-forget: dynamically import runner so missing module doesn't crash the file.
  // The path is constructed at runtime so tsc doesn't resolve the (not-yet-existing) module.
  const runnerPath = new URL("../lib/scout-runner.js", import.meta.url).href;
  (async () => {
    try {
      const mod = await import(/* @vite-ignore */ runnerPath);
      await (mod as { runScout: (id: string) => Promise<void> }).runScout(id);
    } catch {
      // runner not yet implemented — silently ignore
    }
  })();

  return c.json({ ok: true, message: "Run triggered" });
});

// GET /scouts/:id/findings — paginated findings for a scout
scouts.get("/:id/findings", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const scout = await prisma.scout.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!scout) return c.json({ error: "Not found" }, 404);

  const { type, cursor, limit: limitParam } = c.req.query();
  const limit = Math.min(parseInt(limitParam ?? "50", 10) || 50, 100);

  if (cursor && isNaN(new Date(cursor).getTime())) {
    return c.json({ error: "Invalid cursor" }, 400);
  }

  const where: Record<string, unknown> = { scoutId: id };
  if (type === "insight" || type === "article" || type === "task") {
    where.type = type;
  }
  if (cursor) {
    where.createdAt = { lt: new Date(cursor) };
  }

  const [rows, total] = await Promise.all([
    prisma.scoutFinding.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.scoutFinding.count({ where: { scoutId: id } }),
  ]);

  const findings: ScoutFinding[] = rows.map((row) => ({
    id: row.id,
    scoutId: row.scoutId,
    scoutRunId: row.scoutRunId,
    type: row.type as ScoutFinding["type"],
    title: row.title,
    description: row.description,
    sourceUrl: row.sourceUrl ?? undefined,
    sourceName: row.sourceName,
    relevanceScore: row.relevanceScore,
    reasoning: row.reasoning,
    itemId: row.itemId ?? undefined,
    dismissed: row.dismissed,
    createdAt: row.createdAt.toISOString(),
  }));

  const nextCursor = rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : null;

  return c.json({ findings, total, cursor: nextCursor });
});

// POST /scouts/:id/findings/:findingId/dismiss — dismiss a finding
scouts.post("/:id/findings/:findingId/dismiss", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const findingId = c.req.param("findingId");

  const scout = await prisma.scout.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!scout) return c.json({ error: "Not found" }, 404);

  const finding = await prisma.scoutFinding.findFirst({
    where: { id: findingId, scoutId: id },
  });
  if (!finding) return c.json({ error: "Finding not found" }, 404);

  await prisma.scoutFinding.update({
    where: { id: findingId },
    data: { dismissed: true },
  });

  if (finding.itemId) {
    await prisma.item.delete({ where: { id: finding.itemId } });
  }

  return c.json({ ok: true });
});

// POST /scouts/:id/findings/:findingId/promote — promote a finding to an item
scouts.post("/:id/findings/:findingId/promote", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const findingId = c.req.param("findingId");

  const scout = await prisma.scout.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!scout) return c.json({ error: "Not found" }, 404);

  const finding = await prisma.scoutFinding.findFirst({
    where: { id: findingId, scoutId: id },
  });
  if (!finding) return c.json({ error: "Finding not found" }, 404);
  if (finding.itemId) return c.json({ error: "Finding has already been promoted" }, 409);

  const item = await prisma.item.create({
    data: {
      type: finding.type === "task" ? "task" : "content",
      title: finding.title,
      description: finding.description,
      source: "scout",
      sourceId: id,
      sourceUrl: finding.sourceUrl ?? null,
      status: "active",
      userId: user.id,
    },
  });

  await prisma.scoutFinding.update({
    where: { id: findingId },
    data: { itemId: item.id },
  });

  return c.json(item);
});

// GET /scouts/:id/activity — merged run + activity log for a scout
scouts.get("/:id/activity", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const scout = await prisma.scout.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!scout) return c.json({ error: "Not found" }, 404);

  const { cursor, limit: limitParam } = c.req.query();
  const limit = Math.min(parseInt(limitParam ?? "50", 10) || 50, 100);

  if (cursor && isNaN(new Date(cursor).getTime())) {
    return c.json({ error: "Invalid cursor" }, 400);
  }

  const cursorDate = cursor ? new Date(cursor) : undefined;

  const [runs, activities] = await Promise.all([
    prisma.scoutRun.findMany({
      where: { scoutId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.scoutActivity.findMany({
      where: { scoutId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const runEntries: ActivityEntry[] = runs.map((run) => ({
    entryType: "run" as const,
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    status: run.status as ScoutRunStatus,
    resultCount: run.resultCount,
    findingsCount: run.findingsCount,
    dismissedCount: run.dismissedCount,
    reasoning: run.reasoning ?? null,
    durationMs: run.durationMs,
    error: run.error ?? null,
  }));

  const activityEntries: ActivityEntry[] = activities.map((act) => ({
    entryType: "activity" as const,
    id: act.id,
    createdAt: act.createdAt.toISOString(),
    type: act.type as ScoutActivityType,
    description: act.description,
    metadata: act.metadata,
  }));

  // Merge, sort by createdAt desc, apply cursor + limit
  const merged: ActivityEntry[] = [...runEntries, ...activityEntries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const afterCursor = cursorDate
    ? merged.filter((e) => new Date(e.createdAt).getTime() < cursorDate.getTime())
    : merged;

  const page = afterCursor.slice(0, limit);
  const nextCursor = page.length === limit ? page[page.length - 1].createdAt : null;

  return c.json({ entries: page, cursor: nextCursor });
});

export { scouts };
