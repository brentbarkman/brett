import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";

export const users = new Hono<AuthEnv>();

users.get("/", async (c) => {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25));
  const offset = (page - 1) * limit;

  const [userList, total] = await Promise.all([
    prisma.user.findMany({
      skip: offset,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        createdAt: true,
        _count: { select: { items: true, scouts: true } },
      },
    }),
    prisma.user.count(),
  ]);

  return c.json({
    users: userList.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      image: u.image,
      role: u.role,
      createdAt: u.createdAt,
      itemCount: u._count.items,
      scoutCount: u._count.scouts,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

users.get("/:id", async (c) => {
  const userId = c.req.param("id");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      createdAt: true,
      timezone: true,
      city: true,
      _count: { select: { items: true, scouts: true, usageLogs: true } },
    },
  });

  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ user });
});

users.patch("/:id/role", async (c) => {
  const userId = c.req.param("id");
  const currentUser = c.get("user");
  const body = await c.req.json<{ role: string }>().catch(() => null);

  if (!body || !body.role) return c.json({ error: "role is required" }, 400);
  if (body.role !== "user" && body.role !== "admin") {
    return c.json({ error: "role must be 'user' or 'admin'" }, 400);
  }

  // Prevent demoting the last admin (any demotion, not just self)
  if (body.role === "user") {
    const adminCount = await prisma.user.count({ where: { role: "admin" } });
    if (adminCount <= 1) {
      return c.json({ error: "Cannot demote the last admin" }, 400);
    }
  }

  // Use transaction to prevent TOCTOU race on concurrent demotions
  const updated = await prisma.$transaction(async (tx) => {
    if (body.role === "user") {
      const count = await tx.user.count({ where: { role: "admin" } });
      if (count <= 1) throw new Error("Cannot demote the last admin");
    }
    return tx.user.update({
      where: { id: userId },
      data: { role: body.role as "user" | "admin" },
      select: { id: true, email: true, role: true },
    });
  }).catch((err) => {
    if (err.message === "Cannot demote the last admin") return null;
    throw err;
  });

  if (!updated) return c.json({ error: "Cannot demote the last admin" }, 400);
  return c.json({ user: updated });
});
