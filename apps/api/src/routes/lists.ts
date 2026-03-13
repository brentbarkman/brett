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
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: "asc" },
  });

  return c.json(
    userLists.map((l) => ({
      id: l.id,
      name: l.name,
      colorClass: l.colorClass,
      count: l._count.items,
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

  const list = await prisma.list.create({
    data: {
      name: data.name,
      colorClass: data.colorClass ?? "bg-gray-500",
      userId: user.id,
    },
  });

  return c.json(
    { id: list.id, name: list.name, colorClass: list.colorClass, count: 0 },
    201
  );
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
    include: { _count: { select: { items: true } } },
  });

  return c.json({
    id: list.id,
    name: list.name,
    colorClass: list.colorClass,
    count: list._count.items,
  });
});

// DELETE /lists/:id — cascades items
lists.delete("/:id", async (c) => {
  const user = c.get("user");
  const existing = await prisma.list.findFirst({
    where: { id: c.req.param("id"), userId: user.id },
  });
  if (!existing) return c.json({ error: "Not found" }, 404);

  await prisma.list.delete({ where: { id: existing.id } });
  return c.json({ ok: true });
});

export { lists };
