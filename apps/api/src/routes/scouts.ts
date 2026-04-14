import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "@brett/api-core";
import { publishSSE } from "../lib/sse.js";
import type { Scout, ScoutSource, CreateScoutInput, ScoutFinding, ActivityEntry, ScoutBudgetSummary, ScoutRunStatus, ScoutActivityType } from "@brett/types";

const scouts = new Hono<AuthEnv>();

const VALID_RUN_STATUSES = new Set(["running", "success", "failed", "skipped"]);
const VALID_ACTIVITY_TYPES = new Set(["created", "paused", "resumed", "completed", "expired", "config_changed", "cadence_adapted", "budget_alert"]);

function asRunStatus(value: string): ScoutRunStatus {
  if (!VALID_RUN_STATUSES.has(value)) {
    console.warn(`[scouts] Unknown ScoutRunStatus: ${value}, defaulting to "failed"`);
    return "failed" as ScoutRunStatus;
  }
  return value as ScoutRunStatus;
}

function asActivityType(value: string): ScoutActivityType {
  if (!VALID_ACTIVITY_TYPES.has(value)) {
    console.warn(`[scouts] Unknown ScoutActivityType: ${value}, defaulting to "config_changed"`);
    return "config_changed" as ScoutActivityType;
  }
  return value as ScoutActivityType;
}

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
    analysisTier: scout.analysisTier ?? "standard",
    cadenceIntervalHours: scout.cadenceIntervalHours,
    cadenceMinIntervalHours: scout.cadenceMinIntervalHours,
    cadenceCurrentIntervalHours: scout.cadenceCurrentIntervalHours,
    cadenceReason: scout.cadenceReason ?? undefined,
    budgetUsed: scout.budgetUsed,
    budgetTotal: scout.budgetTotal,
    status: scout.status,
    statusLine: scout.statusLine ?? undefined,
    bootstrapped: scout.bootstrapped ?? false,
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
      _count: { select: { findings: true } },
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
      analysisTier: body.analysisTier ?? "standard",
      cadenceIntervalHours: body.cadenceIntervalHours,
      cadenceMinIntervalHours: body.cadenceMinIntervalHours,
      cadenceCurrentIntervalHours: body.cadenceIntervalHours,
      budgetTotal: body.budgetTotal,
      budgetResetAt,
      nextRunAt: null,
      statusLine: "Surveying the landscape...",
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

  // Fire-and-forget bootstrap run
  import("../lib/scout-runner.js")
    .then((mod) => mod.runBootstrapScout(created.id))
    .catch((err) => console.error(`[scouts] Bootstrap failed for ${created.id}:`, err));

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

// GET /scouts/findings/recent — recent findings across all user's scouts (must be before /:id)
scouts.get("/findings/recent", async (c) => {
  const user = c.get("user");
  const { limit: limitParam } = c.req.query();
  const limit = Math.min(parseInt(limitParam ?? "20", 10) || 20, 50);

  const rows = await prisma.scoutFinding.findMany({
    where: {
      scout: { userId: user.id },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      scout: {
        select: {
          name: true,
          avatarLetter: true,
          avatarGradientFrom: true,
          avatarGradientTo: true,
        },
      },
    },
  });

  const findings = rows.map((row) => ({
    id: row.id,
    scoutId: row.scoutId,
    itemId: row.itemId ?? undefined,
    type: row.type as ScoutFinding["type"],
    title: row.title,
    description: row.description,
    sourceUrl: row.sourceUrl ?? undefined,
    sourceName: row.sourceName,
    relevanceScore: row.relevanceScore,
    createdAt: row.createdAt.toISOString(),
    scoutName: row.scout.name,
    scoutAvatarLetter: row.scout.avatarLetter,
    scoutAvatarGradient: [row.scout.avatarGradientFrom, row.scout.avatarGradientTo] as [string, string],
  }));

  return c.json({ findings });
});

// GET /scouts/:id — scout detail
scouts.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const scout = await prisma.scout.findFirst({
    where: { id, userId: user.id },
    include: {
      _count: { select: { findings: true } },
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
  if (body.sources !== undefined) {
    if (!Array.isArray(body.sources)) {
      return c.json({ error: "sources must be an array" }, 400);
    }
    scoutUpdateData.sources = body.sources as unknown as Prisma.InputJsonValue;
  }
  if (body.sensitivity !== undefined) scoutUpdateData.sensitivity = body.sensitivity;
  if (body.analysisTier !== undefined) {
    if (!["standard", "deep"].includes(body.analysisTier)) {
      return c.json({ error: "analysisTier must be 'standard' or 'deep'" }, 400);
    }
    scoutUpdateData.analysisTier = body.analysisTier;
  }
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
          description: `Updated ${Object.keys(after).join(", ")}`,
          metadata: { before, after } as unknown as Prisma.InputJsonValue,
        },
      },
    },
    include: {
      _count: { select: { findings: true } },
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

// DELETE /scouts/:id — hard delete (cascades runs, findings, activity; promoted items are preserved via SetNull)
scouts.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const existing = await prisma.scout.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  await prisma.scout.delete({ where: { id: existing.id } });

  publishSSE(user.id, { type: "scout.status.changed", payload: { scoutId: id, status: "deleted" } });

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
      _count: { select: { findings: true } },
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
      _count: { select: { findings: true } },
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

// DEV ONLY: Clear scout history (findings, runs, activity)
scouts.delete("/:id/history", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const scout = await prisma.scout.findFirst({ where: { id, userId: user.id } });
  if (!scout) return c.json({ error: "Not found" }, 404);

  // Delete in order: memories/consolidations, findings (FK to runs), runs, activity.
  // ScoutMemory, ScoutConsolidation, ScoutRun, and ScoutActivity are not soft-delete
  // models so deleteMany is a true hard delete. ScoutFinding IS a soft-delete model,
  // so we bypass the extension with raw SQL to hard-delete — otherwise soft-deleted
  // findings would be left with dangling scoutRunId FK references after runs are removed.
  await prisma.scoutMemory.deleteMany({ where: { scoutId: id } });
  await prisma.scoutConsolidation.deleteMany({ where: { scoutId: id } });
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "ScoutFinding" WHERE "scoutId" = ${id}`);
  await prisma.scoutRun.deleteMany({ where: { scoutId: id } });
  await prisma.scoutActivity.deleteMany({ where: { scoutId: id } });

  // Reset budget and consolidation state
  await prisma.scout.update({
    where: { id },
    data: { budgetUsed: 0, consolidationRunCount: 0, lastConsolidatedAt: null },
  });

  return c.json({ ok: true });
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

  // Fire-and-forget
  import("../lib/scout-runner.js")
    .then((mod) => mod.runScout(id))
    .catch((err) => console.error(`[scouts] Manual run failed for ${id}:`, err));

  return c.json({ ok: true, message: "Run triggered" });
});

// POST /scouts/:id/consolidate — DEV ONLY: manually trigger memory consolidation
scouts.post("/:id/consolidate", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const scout = await prisma.scout.findFirst({
    where: { id, userId: user.id },
  });
  if (!scout) return c.json({ error: "Not found" }, 404);

  // Rate limit: reject if a consolidation is already in progress
  const pendingConsolidation = await prisma.scoutConsolidation.findFirst({
    where: { scoutId: id, status: { in: ["pending", "processing"] } },
  });
  if (pendingConsolidation) {
    return c.json({ error: "A consolidation is already in progress for this scout" }, 429);
  }

  // Fire-and-forget
  import("../lib/scout-runner.js")
    .then((mod) => mod.triggerConsolidation(id))
    .catch((err) => console.error(`[scouts] Manual consolidation failed for ${id}:`, err));

  return c.json({ ok: true, message: "Consolidation triggered" });
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
      include: { item: { select: { status: true } } },
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
    feedbackUseful: row.feedbackUseful ?? undefined,
    feedbackAt: row.feedbackAt?.toISOString(),
    itemCompleted: row.item?.status === "done",
    createdAt: row.createdAt.toISOString(),
  }));

  const nextCursor = rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : null;

  return c.json({ findings, total, cursor: nextCursor });
});

// POST /scouts/:id/findings/:findingId/feedback — submit finding feedback
scouts.post("/:id/findings/:findingId/feedback", async (c) => {
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

  const body = await c.req.json<{ useful: boolean | null }>();
  if (body.useful !== null && body.useful !== true && body.useful !== false) {
    return c.json({ error: "useful must be true, false, or null" }, 400);
  }

  const updated = await prisma.scoutFinding.update({
    where: { id: findingId },
    data: {
      feedbackUseful: body.useful,
      feedbackAt: body.useful !== null ? new Date() : null,
    },
  });

  return c.json({
    id: updated.id,
    feedbackUseful: updated.feedbackUseful,
    feedbackAt: updated.feedbackAt?.toISOString(),
  });
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
    status: asRunStatus(run.status),
    resultCount: run.resultCount,
    findingsCount: run.findingsCount,
    dismissedCount: run.dismissedCount,
    reasoning: run.reasoning ?? null,
    durationMs: run.durationMs,
    tokensUsed: run.tokensUsed,
    error: run.error ?? null,
  }));

  const activityEntries: ActivityEntry[] = activities.map((act) => ({
    entryType: "activity" as const,
    id: act.id,
    createdAt: act.createdAt.toISOString(),
    type: asActivityType(act.type),
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

// GET /scouts/:id/memories — list active memories
scouts.get("/:id/memories", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const scout = await prisma.scout.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!scout) return c.json({ error: "Not found" }, 404);

  const { type } = c.req.query();
  const where: Record<string, unknown> = { scoutId: id, status: "active" };
  if (type === "factual" || type === "judgment" || type === "pattern") {
    where.type = type;
  }

  const memories = await prisma.scoutMemory.findMany({
    where,
    orderBy: [{ type: "asc" }, { confidence: "desc" }],
  });

  return c.json(memories.map((m) => ({
    id: m.id,
    scoutId: m.scoutId,
    type: m.type,
    content: m.content,
    confidence: m.confidence,
    sourceRunIds: m.sourceRunIds,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  })));
});

// DELETE /scouts/:id/memories/:memoryId — user-delete a memory
scouts.delete("/:id/memories/:memoryId", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const memoryId = c.req.param("memoryId");

  const scout = await prisma.scout.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!scout) return c.json({ error: "Not found" }, 404);

  const memory = await prisma.scoutMemory.findFirst({
    where: { id: memoryId, scoutId: id, status: "active" },
  });
  if (!memory) return c.json({ error: "Memory not found" }, 404);

  await prisma.scoutMemory.update({
    where: { id: memoryId },
    data: { status: "user_deleted", supersededAt: new Date() },
  });

  return c.body(null, 204);
});

// GET /scouts/:id/consolidations — consolidation history
scouts.get("/:id/consolidations", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const scout = await prisma.scout.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!scout) return c.json({ error: "Not found" }, 404);

  const { cursor, limit: limitParam } = c.req.query();
  const limit = Math.min(parseInt(limitParam ?? "20", 10) || 20, 50);

  const where: Record<string, unknown> = { scoutId: id };
  if (cursor) {
    where.createdAt = { lt: new Date(cursor) };
  }

  const rows = await prisma.scoutConsolidation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return c.json({
    consolidations: rows.map((r) => ({
      id: r.id,
      scoutId: r.scoutId,
      runsSinceLastConsolidation: r.runsSinceLastConsolidation,
      memoriesBefore: r.memoriesBefore,
      memoriesAfter: r.memoriesAfter,
      memoriesCreated: r.memoriesCreated,
      memoriesSuperseded: r.memoriesSuperseded,
      tokensUsed: r.tokensUsed,
      tokensInput: r.tokensInput,
      tokensOutput: r.tokensOutput,
      modelId: r.modelId,
      isBatch: r.isBatch,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    })),
    cursor: rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : null,
  });
});

export { scouts };
