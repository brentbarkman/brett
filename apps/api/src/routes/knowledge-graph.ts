import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { findConnected, findEntitiesBySimilarity } from "@brett/ai";
import { getEmbeddingProvider } from "../lib/embedding-provider.js";

const knowledgeGraph = new Hono<AuthEnv>();
knowledgeGraph.use("*", authMiddleware);

// GET /entities — List user's knowledge entities
knowledgeGraph.get("/entities", async (c) => {
  const user = c.get("user");
  const type = c.req.query("type");

  const entities = await prisma.knowledgeEntity.findMany({
    where: { userId: user.id, ...(type ? { type } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, type: true, name: true, properties: true, createdAt: true, updatedAt: true },
  });

  return c.json({ entities });
});

// GET /entities/search?q=... — Semantic entity search (BEFORE /:id route!)
knowledgeGraph.get("/entities/search", async (c) => {
  const user = c.get("user");
  const query = c.req.query("q");
  if (!query) return c.json({ error: "Query required" }, 400);

  const provider = getEmbeddingProvider();
  if (!provider) return c.json({ entities: [] });

  const entities = await findEntitiesBySimilarity(user.id, query, provider, prisma);
  return c.json({ entities });
});

// GET /entities/:id/connections — Get connected entities
knowledgeGraph.get("/entities/:id/connections", async (c) => {
  const user = c.get("user");
  const entityId = c.req.param("id");
  const hops = Math.min(parseInt(c.req.query("hops") ?? "2"), 3);

  const entity = await prisma.knowledgeEntity.findFirst({
    where: { id: entityId, userId: user.id },
  });
  if (!entity) return c.json({ error: "Entity not found" }, 404);

  const connections = await findConnected(user.id, entityId, prisma, hops);
  return c.json({ connections });
});

export { knowledgeGraph };
