import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";
import { estimateCost } from "../lib/pricing.js";

export const users = new Hono<AuthEnv>();

users.get("/", async (c) => {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25));
  const offset = (page - 1) * limit;

  const now = Date.now();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const [userList, total, usageLogs7d, usageLogs30d, scoutRuns7d, scoutRuns30d] = await Promise.all([
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
        banned: true,
        banReason: true,
        createdAt: true,
        _count: { select: { items: true, scouts: true } },
      },
    }),
    prisma.user.count(),
    prisma.aIUsageLog.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: since7d } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.aIUsageLog.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: since30d } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.scoutRun.findMany({
      where: { createdAt: { gte: since7d }, status: "success" },
      select: { tokensInput: true, tokensOutput: true, modelId: true, scout: { select: { userId: true } } },
    }),
    prisma.scoutRun.findMany({
      where: { createdAt: { gte: since30d }, status: "success" },
      select: { tokensInput: true, tokensOutput: true, modelId: true, scout: { select: { userId: true } } },
    }),
  ]);

  // Build per-user spend maps (AI usage logs use default pricing since model isn't grouped)
  const spend7d: Record<string, number> = {};
  const spend30d: Record<string, number> = {};

  for (const g of usageLogs7d) {
    spend7d[g.userId] = (spend7d[g.userId] ?? 0) + estimateCost(null, g._sum.inputTokens ?? 0, g._sum.outputTokens ?? 0);
  }
  for (const g of usageLogs30d) {
    spend30d[g.userId] = (spend30d[g.userId] ?? 0) + estimateCost(null, g._sum.inputTokens ?? 0, g._sum.outputTokens ?? 0);
  }
  for (const r of scoutRuns7d) {
    const uid = r.scout?.userId;
    if (uid) spend7d[uid] = (spend7d[uid] ?? 0) + estimateCost(r.modelId, r.tokensInput ?? 0, r.tokensOutput ?? 0);
  }
  for (const r of scoutRuns30d) {
    const uid = r.scout?.userId;
    if (uid) spend30d[uid] = (spend30d[uid] ?? 0) + estimateCost(r.modelId, r.tokensInput ?? 0, r.tokensOutput ?? 0);
  }

  return c.json({
    users: userList.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      image: u.image,
      role: u.role,
      banned: u.banned,
      banReason: u.banReason,
      createdAt: u.createdAt,
      itemCount: u._count.items,
      scoutCount: u._count.scouts,
      spend7d: Math.round((spend7d[u.id] ?? 0) * 100) / 100,
      spend30d: Math.round((spend30d[u.id] ?? 0) * 100) / 100,
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

// POST /admin/users/:id/lock — ban a user
users.post("/:id/lock", async (c) => {
  const userId = c.req.param("id");
  const currentUser = c.get("user");
  const body = await c.req.json<{ reason?: string }>().catch(() => ({}));

  // Cannot lock yourself
  if (userId === currentUser.id) {
    return c.json({ error: "Cannot lock your own account" }, 400);
  }

  // Cannot lock another admin
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, banned: true },
  });
  if (!target) return c.json({ error: "User not found" }, 404);
  if (target.role === "admin") return c.json({ error: "Cannot lock an admin account" }, 400);
  if (target.banned) return c.json({ error: "User is already locked" }, 400);

  // Lock the user and revoke all their sessions
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { banned: true, banReason: (body as any)?.reason || null },
    }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);

  return c.json({ ok: true });
});

// POST /admin/users/:id/unlock — unban a user
users.post("/:id/unlock", async (c) => {
  const userId = c.req.param("id");

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, banned: true },
  });
  if (!target) return c.json({ error: "User not found" }, 404);
  if (!target.banned) return c.json({ error: "User is not locked" }, 400);

  await prisma.user.update({
    where: { id: userId },
    data: { banned: false, banReason: null },
  });

  return c.json({ ok: true });
});

// DELETE /admin/users/:id — permanently delete a user and all their data
users.delete("/:id", async (c) => {
  const userId = c.req.param("id");
  const currentUser = c.get("user");

  if (userId === currentUser.id) {
    return c.json({ error: "Cannot delete your own account" }, 400);
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!target) return c.json({ error: "User not found" }, 404);
  if (target.role === "admin") return c.json({ error: "Cannot delete an admin account — demote first" }, 400);

  // Delete in order: dependent data first, then user
  // Passkeys cascade automatically. Sessions, Accounts, Verification handled by better-auth.
  // We need to clean up application data explicitly.
  await prisma.$transaction([
    prisma.scoutActivity.deleteMany({ where: { scout: { userId } } }),
    prisma.scoutMemory.deleteMany({ where: { scout: { userId } } }),
    prisma.scoutConsolidation.deleteMany({ where: { scout: { userId } } }),
    prisma.scoutFinding.deleteMany({ where: { scout: { userId } } }),
    prisma.scoutRun.deleteMany({ where: { scout: { userId } } }),
    prisma.scout.deleteMany({ where: { userId } }),
    prisma.conversationEmbedding.deleteMany({ where: { userId } }),
    prisma.userFact.deleteMany({ where: { userId } }),
    prisma.conversationMessage.deleteMany({ where: { session: { userId } } }),
    prisma.conversationSession.deleteMany({ where: { userId } }),
    prisma.aIUsageLog.deleteMany({ where: { userId } }),
    prisma.userAIConfig.deleteMany({ where: { userId } }),
    prisma.brettMessage.deleteMany({ where: { userId } }),
    prisma.calendarEventNote.deleteMany({ where: { userId } }),
    prisma.calendarEvent.deleteMany({ where: { userId } }),
    prisma.calendarList.deleteMany({ where: { googleAccount: { userId } } }),
    prisma.googleAccount.deleteMany({ where: { userId } }),
    prisma.weatherCache.deleteMany({ where: { userId } }),
    prisma.meetingNote.deleteMany({ where: { userId } }),
    prisma.granolaAccount.deleteMany({ where: { userId } }),
    prisma.attachment.deleteMany({ where: { userId } }),
    prisma.itemLink.deleteMany({ where: { userId } }),
    prisma.item.deleteMany({ where: { userId } }),
    prisma.list.deleteMany({ where: { userId } }),
    prisma.passkey.deleteMany({ where: { userId } }),
    prisma.session.deleteMany({ where: { userId } }),
    prisma.account.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  return c.json({ ok: true });
});
