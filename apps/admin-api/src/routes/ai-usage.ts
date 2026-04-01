import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-3-20240307": { input: 0.25, output: 1.25 },
  "claude-3-5-haiku-20241022": { input: 1.0, output: 5.0 },
};
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

function estimateCost(model: string | null, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model ?? ""] ?? DEFAULT_PRICING;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export const aiUsage = new Hono<AuthEnv>();

aiUsage.get("/usage", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const logs = await prisma.aIUsageLog.findMany({
    where: { createdAt: { gte: since } },
    select: { model: true, modelTier: true, source: true, inputTokens: true, outputTokens: true },
  });

  const byModel: Record<string, { inputTokens: number; outputTokens: number; count: number; costUsd: number }> = {};
  const bySource: Record<string, { inputTokens: number; outputTokens: number; count: number; costUsd: number }> = {};

  for (const log of logs) {
    const model = log.model ?? "unknown";
    const source = log.source ?? "unknown";
    const cost = estimateCost(log.model, log.inputTokens, log.outputTokens);

    if (!byModel[model]) byModel[model] = { inputTokens: 0, outputTokens: 0, count: 0, costUsd: 0 };
    byModel[model].inputTokens += log.inputTokens;
    byModel[model].outputTokens += log.outputTokens;
    byModel[model].count += 1;
    byModel[model].costUsd += cost;

    if (!bySource[source]) bySource[source] = { inputTokens: 0, outputTokens: 0, count: 0, costUsd: 0 };
    bySource[source].inputTokens += log.inputTokens;
    bySource[source].outputTokens += log.outputTokens;
    bySource[source].count += 1;
    bySource[source].costUsd += cost;
  }

  for (const v of Object.values(byModel)) v.costUsd = Math.round(v.costUsd * 100) / 100;
  for (const v of Object.values(bySource)) v.costUsd = Math.round(v.costUsd * 100) / 100;

  return c.json({ days, byModel, bySource });
});

aiUsage.get("/usage/daily", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const logs = await prisma.aIUsageLog.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, model: true, inputTokens: true, outputTokens: true },
    orderBy: { createdAt: "asc" },
  });

  const daily: Record<string, { tokens: number; costUsd: number; count: number }> = {};

  for (const log of logs) {
    const day = log.createdAt.toISOString().slice(0, 10);
    if (!daily[day]) daily[day] = { tokens: 0, costUsd: 0, count: 0 };
    daily[day].tokens += log.inputTokens + log.outputTokens;
    daily[day].costUsd += estimateCost(log.model, log.inputTokens, log.outputTokens);
    daily[day].count += 1;
  }

  for (const v of Object.values(daily)) v.costUsd = Math.round(v.costUsd * 100) / 100;

  return c.json({
    days,
    daily: Object.entries(daily).map(([date, data]) => ({ date, ...data })),
  });
});

aiUsage.get("/sessions", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25));

  const sessions = await prisma.conversationSession.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      source: true,
      modelTier: true,
      modelUsed: true,
      userId: true,
      user: { select: { email: true, name: true } },
      _count: { select: { messages: true } },
    },
  });

  return c.json({ sessions });
});
