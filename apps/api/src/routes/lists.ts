import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { validateCreateList } from "@brett/business";

const lists = new Hono<AuthEnv>();

// All routes require auth
lists.use("*", authMiddleware);

// GET /lists — all lists for user with item counts
lists.get("/", async (c) => {
  const user = c.get("user");

  const userLists = await prisma.list.findMany({
    where: { userId: user.id },
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

  // Auto-assign sortOrder as max + 1
  const maxSort = await prisma.list.aggregate({
    where: { userId: user.id },
    _max: { sortOrder: true },
  });
  const nextSortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const list = await prisma.list.create({
    data: {
      name: data.name,
      colorClass: data.colorClass ?? "bg-gray-500",
      sortOrder: nextSortOrder,
      userId: user.id,
    },
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

  // Validate all IDs belong to the user
  const userLists = await prisma.list.findMany({
    where: { userId: user.id },
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

// PATCH /lists/:id — update
lists.patch("/:id", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const existing = await prisma.list.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.colorClass !== undefined) updateData.colorClass = body.colorClass;

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
