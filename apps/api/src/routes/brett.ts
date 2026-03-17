import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { validateCreateBrettMessage } from "@brett/business";

const brett = new Hono<AuthEnv>();
brett.use("*", authMiddleware);

// POST /things/:itemId/brett — send message, get stub response
brett.post("/:itemId/brett", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");

  const item = await prisma.item.findFirst({ where: { id: itemId, userId: user.id } });
  if (!item) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const validation = validateCreateBrettMessage(body);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const userMessage = await prisma.brettMessage.create({
    data: { itemId, role: "user", content: validation.data.content, userId: user.id },
  });

  const stubResponse = "I'll think about that and get back to you. (AI responses coming soon)";
  const brettMessage = await prisma.brettMessage.create({
    data: { itemId, role: "brett", content: stubResponse, userId: user.id },
  });

  return c.json({
    userMessage: { id: userMessage.id, role: userMessage.role, content: userMessage.content, createdAt: userMessage.createdAt.toISOString() },
    brettMessage: { id: brettMessage.id, role: brettMessage.role, content: brettMessage.content, createdAt: brettMessage.createdAt.toISOString() },
  }, 201);
});

// GET /things/:itemId/brett — paginated messages (newest first)
brett.get("/:itemId/brett", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");

  const item = await prisma.item.findFirst({ where: { id: itemId, userId: user.id } });
  if (!item) return c.json({ error: "Not found" }, 404);

  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);
  const cursor = c.req.query("cursor");

  const messages = await prisma.brettMessage.findMany({
    where: { itemId, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;

  return c.json({
    messages: page.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
    hasMore,
    cursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
  });
});

// POST /things/:itemId/brett-take — generate/refresh observation
brett.post("/:itemId/brett-take", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");

  const item = await prisma.item.findFirst({ where: { id: itemId, userId: user.id } });
  if (!item) return c.json({ error: "Not found" }, 404);

  const observation = `This task "${item.title}" looks interesting. I'll have more to say once AI integration is set up.`;
  const now = new Date();

  await prisma.item.update({
    where: { id: item.id },
    data: { brettObservation: observation, brettTakeGeneratedAt: now },
  });

  return c.json({ brettObservation: observation, brettTakeGeneratedAt: now.toISOString() });
});

export { brett };
