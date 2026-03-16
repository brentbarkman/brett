import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { validateCreateList, validateUpdateList } from "@brett/business";

const lists = new Hono<AuthEnv>();

// All routes require auth
lists.use("*", authMiddleware);

// GET /lists — all lists for user with item counts
lists.get("/", async (c) => {
  const user = c.get("user");
  const archived = c.req.query("archived");

  const where: Record<string, unknown> = { userId: user.id };
  if (archived === "true") {
    where.archivedAt = { not: null };
  } else {
    where.archivedAt = null;
  }

  const userLists = await prisma.list.findMany({
    where,
    include: {
      _count: {
        select: {
          items: true,
        },
      },
      items: {
        where: { status: "done" },
        select: { id: true },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  return c.json(
    userLists.map((l) => ({
      id: l.id,
      name: l.name,
      colorClass: l.colorClass,
      count: l._count.items,
      completedCount: l.items.length,
      sortOrder: l.sortOrder,
      archivedAt: l.archivedAt?.toISOString() ?? null,
    }))
  );
});

// POST /lists — create
lists.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const validation = validateCreateList(body);

  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const { data } = validation;

  // Check for duplicate name
  const existing = await prisma.list.findUnique({
    where: { userId_name: { userId: user.id, name: data.name } },
  });
  if (existing) {
    return c.json({ error: "A list with this name already exists" }, 409);
  }

  // New lists go to the top — shift existing lists down, insert at 0
  const list = await prisma.$transaction(async (tx) => {
    await tx.list.updateMany({
      where: { userId: user.id },
      data: { sortOrder: { increment: 1 } },
    });
    return tx.list.create({
      data: {
        name: data.name,
        colorClass: data.colorClass ?? "bg-blue-400",
        sortOrder: 0,
        userId: user.id,
      },
    });
  });

  return c.json(
    { id: list.id, name: list.name, colorClass: list.colorClass, count: 0, completedCount: 0, sortOrder: list.sortOrder, archivedAt: null },
    201
  );
});

// PUT /lists/reorder — reorder lists
lists.put("/reorder", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: "ids must be a non-empty array" }, 400);
  }

  if (!ids.every((id: unknown) => typeof id === "string")) {
    return c.json({ error: "ids must be strings" }, 400);
  }

  // Validate all IDs belong to the user
  const userLists = await prisma.list.findMany({
    where: { userId: user.id, archivedAt: null },
    select: { id: true },
  });
  const userListIds = new Set(userLists.map((l) => l.id));

  for (const id of ids) {
    if (!userListIds.has(id)) {
      return c.json({ error: `List ${id} not found` }, 400);
    }
  }

  // Check all user lists are accounted for
  if (ids.length !== userLists.length) {
    return c.json({ error: "ids must include all user lists" }, 400);
  }

  // Update sortOrder for each list
  await prisma.$transaction(
    ids.map((id: string, index: number) =>
      prisma.list.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );

  return c.json({ ok: true });
});

// PATCH /lists/:id/archive — archive a list and mark incomplete items as done
lists.patch("/:id/archive", async (c) => {
  const user = c.get("user");
  const existing = await prisma.list.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const now = new Date();

  const [, updateResult] = await prisma.$transaction([
    prisma.list.update({
      where: { id: existing.id },
      data: { archivedAt: now },
    }),
    prisma.item.updateMany({
      where: { listId: existing.id, status: { not: "done" } },
      data: { status: "done", completedAt: now },
    }),
  ]);

  return c.json({
    archivedAt: now.toISOString(),
    itemsCompleted: updateResult.count,
  });
});

// PATCH /lists/:id/unarchive — unarchive a list
lists.patch("/:id/unarchive", async (c) => {
  const user = c.get("user");
  const existing = await prisma.list.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const list = await prisma.list.update({
    where: { id: existing.id },
    data: { archivedAt: null },
    include: {
      _count: { select: { items: true } },
      items: { where: { status: "done" }, select: { id: true } },
    },
  });

  return c.json({
    id: list.id,
    name: list.name,
    colorClass: list.colorClass,
    count: list._count.items,
    completedCount: list.items.length,
    sortOrder: list.sortOrder,
    archivedAt: list.archivedAt?.toISOString() ?? null,
  });
});

// PATCH /lists/:id — update
lists.patch("/:id", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const validation = validateUpdateList(body);

  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const existing = await prisma.list.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const updateData: Record<string, unknown> = {};
  if (validation.data.name !== undefined) updateData.name = validation.data.name;
  if (validation.data.colorClass !== undefined) updateData.colorClass = validation.data.colorClass;

  const list = await prisma.list.update({
    where: { id: existing.id },
    data: updateData,
    include: {
      _count: { select: { items: true } },
      items: { where: { status: "done" }, select: { id: true } },
    },
  });

  return c.json({
    id: list.id,
    name: list.name,
    colorClass: list.colorClass,
    count: list._count.items,
    completedCount: list.items.length,
    sortOrder: list.sortOrder,
    archivedAt: existing.archivedAt?.toISOString() ?? null,
  });
});

// DELETE /lists/:id — deletes list and all its items
lists.delete("/:id", async (c) => {
  const user = c.get("user");
  const existing = await prisma.list.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  await prisma.$transaction([
    prisma.item.deleteMany({ where: { listId: existing.id } }),
    prisma.list.delete({ where: { id: existing.id } }),
  ]);
  return c.json({ ok: true });
});

export { lists };
