import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";
import { estimateCost } from "../lib/pricing.js";

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
    orderBy: { createdAt: "desc" },
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
    daily: Object.entries(daily)
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => b.date.localeCompare(a.date)),
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
      usageLogs: {
        select: { inputTokens: true, outputTokens: true },
      },
    },
  });

  // Flatten token totals per session
  const result = sessions.map((s) => {
    const inputTokens = s.usageLogs.reduce((sum, l) => sum + l.inputTokens, 0);
    const outputTokens = s.usageLogs.reduce((sum, l) => sum + l.outputTokens, 0);
    const { usageLogs: _, ...rest } = s;
    return {
      ...rest,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: Math.round(estimateCost(s.modelUsed, inputTokens, outputTokens) * 100) / 100,
    };
  });

  return c.json({ sessions: result });
});
