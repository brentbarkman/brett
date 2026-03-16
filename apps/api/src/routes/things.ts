import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { itemToThing, validateCreateItem, validateBulkUpdate } from "@brett/business";

const things = new Hono<AuthEnv>();

async function verifyListOwnership(listId: string, userId: string) {
  const list = await prisma.list.findFirst({
    where: { id: listId, userId },
  });
  return !!list;
}

// All routes require auth
things.use("*", authMiddleware);

// GET /things — list things with optional filters
// Supports date range filters:
//   dueBefore=ISO   — items with dueDate <= value (inclusive)
//   dueAfter=ISO    — items with dueDate > value (exclusive)
//   completedAfter=ISO — items with completedAt >= value
things.get("/", async (c) => {
  const user = c.get("user");
  const { listId, type, status, source, dueBefore, dueAfter, completedAfter } = c.req.query();

  const where: Record<string, unknown> = { userId: user.id };
  if (listId) where.listId = listId;
  if (type) where.type = type;
  if (status) where.status = status;
  if (source) where.source = source;
  if (dueBefore && dueAfter) {
    where.dueDate = { gt: new Date(dueAfter), lte: new Date(dueBefore) };
  } else if (dueBefore) {
    where.dueDate = { lte: new Date(dueBefore) };
  } else if (dueAfter) {
    where.dueDate = { gt: new Date(dueAfter) };
  }
  if (completedAfter) where.completedAt = { gte: new Date(completedAfter) };

  const items = await prisma.item.findMany({
    where,
    include: { list: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }],
  });

  const thingsList = items.map((item) => itemToThing(item));
  return c.json(thingsList);
});

// PATCH /things/bulk — bulk update
things.patch("/bulk", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const validation = validateBulkUpdate(body);

  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const { data } = validation;

  // Verify all IDs belong to the user
  const count = await prisma.item.count({
    where: { id: { in: data.ids }, userId: user.id },
  });
  if (count !== data.ids.length) {
    return c.json({ error: "One or more items not found" }, 400);
  }

  // If listId is a non-null string, verify list ownership
  if (typeof data.updates.listId === "string") {
    if (!(await verifyListOwnership(data.updates.listId, user.id))) {
      return c.json({ error: "List not found" }, 400);
    }
  }

  const updateData: Record<string, unknown> = {};
  if (data.updates.listId !== undefined) updateData.listId = data.updates.listId;
  if (data.updates.dueDate !== undefined)
    updateData.dueDate = data.updates.dueDate ? new Date(data.updates.dueDate) : null;
  if (data.updates.dueDatePrecision !== undefined)
    updateData.dueDatePrecision = data.updates.dueDatePrecision;
  if (data.updates.status !== undefined) updateData.status = data.updates.status;

  const result = await prisma.item.updateMany({
    where: { id: { in: data.ids }, userId: user.id },
    data: updateData,
  });

  return c.json({ updated: result.count });
});

// GET /things/inbox — inbox items
things.get("/inbox", async (c) => {
  const user = c.get("user");
  const includeHidden = c.req.query("includeHidden") === "true";
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const baseWhere = {
    userId: user.id,
    listId: null,
    status: { notIn: ["done", "archived", "snoozed"] },
  };

  const visibleItems = await prisma.item.findMany({
    where: {
      ...baseWhere,
      OR: [{ dueDate: null }, { dueDate: { lte: todayStart } }],
      AND: [
        { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
      ],
    },
    include: { list: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }],
  });

  const hiddenCount = await prisma.item.count({
    where: {
      ...baseWhere,
      dueDate: { gt: todayStart },
    },
  });

  const result: { visible: ReturnType<typeof itemToThing>[]; hiddenCount: number; hidden?: ReturnType<typeof itemToThing>[] } = {
    visible: visibleItems.map((item) => itemToThing(item)),
    hiddenCount,
  };

  if (includeHidden && hiddenCount > 0) {
    const hiddenItems = await prisma.item.findMany({
      where: {
        ...baseWhere,
        dueDate: { gt: todayStart },
      },
      include: { list: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }],
    });
    result.hidden = hiddenItems.map((item) => itemToThing(item));
  }

  return c.json(result);
});

// GET /things/:id — single thing
things.get("/:id", async (c) => {
  const user = c.get("user");
  const item = await prisma.item.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
    include: { list: { select: { name: true } } },
  });

  if (!item) return c.json({ error: "Not found" }, 404);
  return c.json(itemToThing(item));
});

// POST /things — create
things.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const validation = validateCreateItem(body);

  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const { data } = validation;

  // If listId provided, verify the list belongs to the user
  if (data.listId && !(await verifyListOwnership(data.listId, user.id))) {
    return c.json({ error: "List not found" }, 400);
  }

  const item = await prisma.item.create({
    data: {
      type: data.type,
      title: data.title,
      description: data.description,
      source: data.source ?? "Brett",
      sourceUrl: data.sourceUrl,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      dueDatePrecision: data.dueDatePrecision ?? null,
      brettObservation: data.brettObservation,
      status: data.status ?? "active",
      listId: data.listId ?? null,
      userId: user.id,
    },
    include: { list: { select: { name: true } } },
  });

  return c.json(itemToThing(item), 201);
});

// PATCH /things/:id — update
things.patch("/:id", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const existing = await prisma.item.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  // If changing list, verify ownership
  if (body.listId && !(await verifyListOwnership(body.listId, user.id))) {
    return c.json({ error: "List not found" }, 400);
  }

  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.source !== undefined) updateData.source = body.source;
  if (body.sourceUrl !== undefined) updateData.sourceUrl = body.sourceUrl;
  if (body.dueDate !== undefined)
    updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  if (body.dueDatePrecision !== undefined)
    updateData.dueDatePrecision = body.dueDatePrecision;
  if (body.brettObservation !== undefined)
    updateData.brettObservation = body.brettObservation;
  if (body.listId !== undefined) updateData.listId = body.listId;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.snoozedUntil !== undefined)
    updateData.snoozedUntil = body.snoozedUntil
      ? new Date(body.snoozedUntil)
      : null;

  const item = await prisma.item.update({
    where: { id: c.req.param("id") },
    data: updateData,
    include: { list: { select: { name: true } } },
  });

  return c.json(itemToThing(item));
});

// PATCH /things/:id/toggle — toggle completion
things.patch("/:id/toggle", async (c) => {
  const user = c.get("user");
  const existing = await prisma.item.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const isCompleted = existing.completedAt !== null;
  const item = await prisma.item.update({
    where: { id: existing.id },
    data: {
      completedAt: isCompleted ? null : new Date(),
      status: isCompleted ? "active" : "done",
    },
    include: { list: { select: { name: true } } },
  });

  return c.json(itemToThing(item));
});

// DELETE /things/:id
things.delete("/:id", async (c) => {
  const user = c.get("user");
  const existing = await prisma.item.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  await prisma.item.delete({ where: { id: existing.id } });
  return c.json({ ok: true });
});

export { things };
