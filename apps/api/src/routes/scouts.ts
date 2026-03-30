import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { publishSSE } from "../lib/sse.js";
import type { Scout, ScoutSource, CreateScoutInput } from "@brett/types";

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
  if (status !== "all") {
    where.status = { not: "completed" };
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

export { scouts };
