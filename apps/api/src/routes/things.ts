import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { getPresignedUrl } from "../lib/storage.js";
import { itemToThing, validateCreateItem, validateBulkUpdate, validateUpdateItem, computeNextDueDate } from "@brett/business";
import type { ThingDetail, Attachment as AttachmentType, ItemLink as ItemLinkType, BrettMessage as BrettMessageType } from "@brett/types";

const things = new Hono<AuthEnv>();

async function itemToThingDetail(item: any): Promise<ThingDetail> {
  const thing = itemToThing(item);

  const attachments: AttachmentType[] = await Promise.all(
    (item.attachments || []).map(async (a: any) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      url: await getPresignedUrl(a.storageKey),
      createdAt: a.createdAt.toISOString(),
    }))
  );

  // Resolve link titles
  const linkTargetIds = (item.linksFrom || []).map((l: any) => l.toItemId);
  const linkTargets = linkTargetIds.length > 0
    ? await prisma.item.findMany({
        where: { id: { in: linkTargetIds }, userId: item.userId },
        select: { id: true, title: true },
      })
    : [];
  const titleMap = new Map(linkTargets.map((t: any) => [t.id, t.title]));

  const links: ItemLinkType[] = (item.linksFrom || []).map((l: any) => ({
    id: l.id,
    toItemId: l.toItemId,
    toItemType: l.toItemType,
    toItemTitle: titleMap.get(l.toItemId),
    createdAt: l.createdAt.toISOString(),
  }));

  const brettMessages: BrettMessageType[] = (item.brettMessages || [])
    .slice(0, 20)
    .map((m: any) => ({
      id: m.id,
      role: m.role as "user" | "brett",
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }));

  return {
    ...thing,
    notes: item.notes ?? undefined,
    reminder: item.reminder ?? undefined,
    recurrence: item.recurrence ?? undefined,
    recurrenceRule: item.recurrenceRule ?? undefined,
    brettTakeGeneratedAt: item.brettTakeGeneratedAt?.toISOString(),
    attachments,
    links,
    brettMessages,
  };
}

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

// GET /things/inbox — items with no due date and no list
things.get("/inbox", async (c) => {
  const user = c.get("user");
  const now = new Date();

  const items = await prisma.item.findMany({
    where: {
      userId: user.id,
      listId: null,
      dueDate: null,
      status: { notIn: ["done", "archived", "snoozed"] },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    },
    include: { list: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }],
  });

  return c.json({
    visible: items.map((item) => itemToThing(item)),
  });
});

// GET /things/:id — single thing (returns ThingDetail with relations)
things.get("/:id", async (c) => {
  const user = c.get("user");
  const item = await prisma.item.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
    include: {
      list: { select: { name: true } },
      attachments: { orderBy: { createdAt: "asc" } },
      linksFrom: { orderBy: { createdAt: "asc" } },
      brettMessages: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!item) return c.json({ error: "Not found" }, 404);
  return c.json(await itemToThingDetail(item));
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
  const validation = validateUpdateItem(body);

  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const { data } = validation;
  const id = c.req.param("id");

  // Verify ownership
  const existing = await prisma.item.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  // If changing list, verify ownership
  if (data.listId && !(await verifyListOwnership(data.listId, user.id))) {
    return c.json({ error: "List not found" }, 400);
  }

  const updateData: Record<string, unknown> = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.source !== undefined) updateData.source = data.source;
  if (data.sourceUrl !== undefined) updateData.sourceUrl = data.sourceUrl;
  if (data.dueDate !== undefined)
    updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.dueDatePrecision !== undefined)
    updateData.dueDatePrecision = data.dueDatePrecision;
  if (data.brettObservation !== undefined)
    updateData.brettObservation = data.brettObservation;
  if (data.listId !== undefined) updateData.listId = data.listId;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.snoozedUntil !== undefined)
    updateData.snoozedUntil = data.snoozedUntil
      ? new Date(data.snoozedUntil)
      : null;
  if (data.notes !== undefined)
    updateData.notes = data.notes;
  if (data.reminder !== undefined)
    updateData.reminder = data.reminder;
  if (data.recurrence !== undefined)
    updateData.recurrence = data.recurrence;
  if (data.recurrenceRule !== undefined)
    updateData.recurrenceRule = data.recurrenceRule;

  const item = await prisma.item.update({
    where: { id: existing.id },
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
    include: { list: { select: { name: true } }, linksFrom: true },
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

  // If completing a recurring task, spawn a new independent task
  if (!isCompleted && existing.recurrence) {
    const newDueDate = computeNextDueDate(
      existing.dueDate,
      existing.recurrence,
      existing.recurrenceRule
    );

    const newItem = await prisma.item.create({
      data: {
        type: existing.type,
        title: existing.title,
        notes: existing.notes,
        description: existing.description,
        source: existing.source,
        dueDate: newDueDate,
        dueDatePrecision: existing.dueDatePrecision,
        recurrence: existing.recurrence,
        recurrenceRule: existing.recurrenceRule,
        listId: existing.listId,
        userId: existing.userId,
      },
    });

    // Copy links (not attachments or brett messages per spec)
    if (existing.linksFrom.length > 0) {
      await prisma.itemLink.createMany({
        data: existing.linksFrom.map((l) => ({
          fromItemId: newItem.id,
          toItemId: l.toItemId,
          toItemType: l.toItemType,
          userId: user.id,
        })),
      });
    }
  }

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
