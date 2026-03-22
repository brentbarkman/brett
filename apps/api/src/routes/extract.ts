import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { runExtraction } from "../lib/content-extractor.js";

const extract = new Hono<AuthEnv>();

// POST /things/:id/extract — trigger or retry content extraction
extract.post("/:id/extract", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const item = await prisma.item.findFirst({
    where: { id, userId: user.id },
    select: { id: true, type: true, sourceUrl: true, contentStatus: true, userId: true },
  });

  if (!item) return c.json({ error: "Not found" }, 404);
  if (item.type !== "content") return c.json({ error: "Not a content item" }, 400);
  if (!item.sourceUrl) return c.json({ error: "No source URL" }, 400);
  if (item.contentStatus === "extracted") return c.json({ error: "Already extracted" }, 400);

  // Atomic update to prevent race conditions
  // Note: Prisma doesn't support mixing strings and null in `in`, so use OR
  const result = await prisma.item.updateMany({
    where: {
      id: item.id,
      OR: [
        { contentStatus: { in: ["failed", "pending"] } },
        { contentStatus: null },
      ],
    },
    data: { contentStatus: "pending" },
  });

  if (result.count === 0) {
    return c.json({ error: "Extraction already in progress or already extracted" }, 409);
  }

  // Fire-and-forget
  runExtraction(item.id, item.sourceUrl, item.userId).catch((err) =>
    console.error(`[extract] Background extraction failed for ${item.id}:`, err)
  );

  return c.json({ status: "pending" }, 202);
});

export default extract;
