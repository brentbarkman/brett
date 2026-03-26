import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";

const aiUsage = new Hono<AuthEnv>();

// All routes require auth
aiUsage.use("*", authMiddleware);

// GET /ai/usage/session/:sessionId — Total tokens for a session
aiUsage.get("/session/:sessionId", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");

  // Exclude background processes (fact_extraction) from session token count —
  // the user wants to see what their conversation cost, not background overhead
  const result = await prisma.aIUsageLog.aggregate({
    where: { userId: user.id, sessionId, source: { not: "fact_extraction" } },
    _sum: { inputTokens: true, outputTokens: true },
  });

  const inputTokens = result._sum.inputTokens ?? 0;
  const outputTokens = result._sum.outputTokens ?? 0;

  return c.json({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  });
});

// GET /ai/usage/summary — Usage summary by provider/model for 24h, 7d, 30d
aiUsage.get("/summary", async (c) => {
  const user = c.get("user");

  const now = Date.now();
  const last24h = new Date(now - 24 * 60 * 60 * 1000);
  const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const [results24h, results7d, results30d] = await Promise.all([
    prisma.aIUsageLog.groupBy({
      by: ["provider", "model"],
      where: { userId: user.id, createdAt: { gte: last24h } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.aIUsageLog.groupBy({
      by: ["provider", "model"],
      where: { userId: user.id, createdAt: { gte: last7d } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.aIUsageLog.groupBy({
      by: ["provider", "model"],
      where: { userId: user.id, createdAt: { gte: last30d } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);

  const mapResults = (rows: typeof results24h) =>
    rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      inputTokens: r._sum.inputTokens ?? 0,
      outputTokens: r._sum.outputTokens ?? 0,
    }));

  return c.json({
    last24h: mapResults(results24h),
    last7d: mapResults(results7d),
    last30d: mapResults(results30d),
  });
});

export { aiUsage };
