import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { itemToThing, validateCreateItem } from "@brett/business";

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
things.get("/", async (c) => {
  const user = c.get("user");
  const { listId, type, status, source } = c.req.query();

  const where: Record<string, unknown> = { userId: user.id };
  if (listId) where.listId = listId;
  if (type) where.type = type;
  if (status) where.status = status;
  if (source) where.source = source;

  const items = await prisma.item.findMany({
    where,
    include: { list: { select: { name: true } } },
    orderBy: [{ createdAt: "desc" }],
  });

  const thingsList = items.map((item) => itemToThing(item));
  return c.json(thingsList);
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
      brettObservation: data.brettObservation,
      status: data.status ?? "inbox",
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
