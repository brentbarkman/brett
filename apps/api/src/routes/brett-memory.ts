import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const brettMemory = new Hono<AuthEnv>();

brettMemory.use("*", authMiddleware);

// GET /facts — User's structured facts
brettMemory.get("/facts", async (c) => {
  const user = c.get("user");

  const facts = await prisma.userFact.findMany({
    where: { userId: user.id, validUntil: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      category: true,
      key: true,
      value: true,
      confidence: true,
      sourceType: true,
      validFrom: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return c.json({ facts });
});

// DELETE /facts/:id — Delete a fact
brettMemory.delete("/facts/:id", async (c) => {
  const user = c.get("user");
  const factId = c.req.param("id");

  const fact = await prisma.userFact.findFirst({
    where: { id: factId, userId: user.id },
  });

  if (!fact) {
    return c.json({ error: "Fact not found" }, 404);
  }

  await prisma.userFact.delete({ where: { id: factId } });

  return c.json({ ok: true });
});

export { brettMemory };
