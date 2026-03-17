import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { validateCreateItemLink } from "@brett/business";

const links = new Hono<AuthEnv>();
links.use("*", authMiddleware);

// POST /things/:itemId/links
links.post("/:itemId/links", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");

  const item = await prisma.item.findFirst({ where: { id: itemId, userId: user.id } });
  if (!item) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const validation = validateCreateItemLink(body);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const { data } = validation;

  if (data.toItemId === itemId) {
    return c.json({ error: "Cannot link an item to itself" }, 400);
  }

  // Verify target item exists and belongs to user
  const targetItem = await prisma.item.findFirst({
    where: { id: data.toItemId, userId: user.id },
  });
  if (!targetItem) {
    return c.json({ error: "Target item not found" }, 404);
  }

  const existing = await prisma.itemLink.findUnique({
    where: { fromItemId_toItemId: { fromItemId: itemId, toItemId: data.toItemId } },
  });
  if (existing) return c.json({ error: "Link already exists" }, 409);

  const link = await prisma.itemLink.create({
    data: { fromItemId: itemId, toItemId: data.toItemId, toItemType: data.toItemType, userId: user.id },
  });

  return c.json({
    id: link.id,
    toItemId: link.toItemId,
    toItemType: link.toItemType,
    createdAt: link.createdAt.toISOString(),
  }, 201);
});

// DELETE /things/:itemId/links/:linkId
links.delete("/:itemId/links/:linkId", async (c) => {
  const user = c.get("user");
  const link = await prisma.itemLink.findFirst({
    where: { id: c.req.param("linkId"), userId: user.id },
  });
  if (!link) return c.json({ error: "Not found" }, 404);

  await prisma.itemLink.delete({ where: { id: link.id } });
  return c.json({ ok: true });
});

export { links };
