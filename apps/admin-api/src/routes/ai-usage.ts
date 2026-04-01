import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";
import { estimateCost } from "../lib/pricing.js";

export const aiUsage = new Hono<AuthEnv>();

// GET /admin/ai/usage — usage breakdown by model/source, includes scout spend
aiUsage.get("/usage", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [logs, scoutRuns] = await Promise.all([
    prisma.aIUsageLog.findMany({
      where: { createdAt: { gte: since } },
      select: { model: true, modelTier: true, source: true, inputTokens: true, outputTokens: true },
    }),
    prisma.scoutRun.findMany({
      where: { createdAt: { gte: since }, status: "success" },
      select: { modelId: true, tokensInput: true, tokensOutput: true },
    }),
  ]);

  const byModel: Record<string, { inputTokens: number; outputTokens: number; count: number; costUsd: number }> = {};
  const byFeature: Record<string, { inputTokens: number; outputTokens: number; count: number; costUsd: number }> = {};

  for (const log of logs) {
    const model = log.model ?? "unknown";
    const feature = log.source ?? "unknown";
    const cost = estimateCost(log.model, log.inputTokens, log.outputTokens);

    if (!byModel[model]) byModel[model] = { inputTokens: 0, outputTokens: 0, count: 0, costUsd: 0 };
    byModel[model].inputTokens += log.inputTokens;
    byModel[model].outputTokens += log.outputTokens;
    byModel[model].count += 1;
    byModel[model].costUsd += cost;

    if (!byFeature[feature]) byFeature[feature] = { inputTokens: 0, outputTokens: 0, count: 0, costUsd: 0 };
    byFeature[feature].inputTokens += log.inputTokens;
    byFeature[feature].outputTokens += log.outputTokens;
    byFeature[feature].count += 1;
    byFeature[feature].costUsd += cost;
  }

  // Add scout spend (tracked separately on ScoutRun, not AIUsageLog)
  for (const run of scoutRuns) {
    const input = run.tokensInput ?? 0;
    const output = run.tokensOutput ?? 0;
    const model = run.modelId ?? "unknown";
    const cost = estimateCost(model, input, output);

    if (!byModel[model]) byModel[model] = { inputTokens: 0, outputTokens: 0, count: 0, costUsd: 0 };
    byModel[model].inputTokens += input;
    byModel[model].outputTokens += output;
    byModel[model].count += 1;
    byModel[model].costUsd += cost;

    if (!byFeature["scouts"]) byFeature["scouts"] = { inputTokens: 0, outputTokens: 0, count: 0, costUsd: 0 };
    byFeature["scouts"].inputTokens += input;
    byFeature["scouts"].outputTokens += output;
    byFeature["scouts"].count += 1;
    byFeature["scouts"].costUsd += cost;
  }

  for (const v of Object.values(byModel)) v.costUsd = Math.round(v.costUsd * 100) / 100;
  for (const v of Object.values(byFeature)) v.costUsd = Math.round(v.costUsd * 100) / 100;

  // Totals (including scouts)
  const totalTokens = [...Object.values(byModel)].reduce((s, m) => s + m.inputTokens + m.outputTokens, 0);
  const totalCost = [...Object.values(byModel)].reduce((s, m) => s + m.costUsd, 0);
  const totalCalls = [...Object.values(byModel)].reduce((s, m) => s + m.count, 0);

  return c.json({
    days,
    totalTokens,
    totalCostUsd: Math.round(totalCost * 100) / 100,
    totalCalls,
    byModel,
    byFeature,
  });
});

// GET /admin/ai/usage/daily — daily spend trend (all time, not filtered by day picker)
aiUsage.get("/usage/daily", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [logs, scoutRuns] = await Promise.all([
    prisma.aIUsageLog.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, model: true, inputTokens: true, outputTokens: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.scoutRun.findMany({
      where: { createdAt: { gte: since }, status: "success" },
      select: { createdAt: true, modelId: true, tokensInput: true, tokensOutput: true },
    }),
  ]);

  const daily: Record<string, { tokens: number; costUsd: number; count: number }> = {};

  for (const log of logs) {
    const day = log.createdAt.toISOString().slice(0, 10);
    if (!daily[day]) daily[day] = { tokens: 0, costUsd: 0, count: 0 };
    daily[day].tokens += log.inputTokens + log.outputTokens;
    daily[day].costUsd += estimateCost(log.model, log.inputTokens, log.outputTokens);
    daily[day].count += 1;
  }

  for (const run of scoutRuns) {
    const day = run.createdAt.toISOString().slice(0, 10);
    const input = run.tokensInput ?? 0;
    const output = run.tokensOutput ?? 0;
    if (!daily[day]) daily[day] = { tokens: 0, costUsd: 0, count: 0 };
    daily[day].tokens += input + output;
    daily[day].costUsd += estimateCost(run.modelId, input, output);
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

// GET /admin/ai/sessions — recent conversation sessions + scout runs
aiUsage.get("/sessions", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 25));
  const halfLimit = Math.ceil(limit / 2);

  const [sessions, scoutRunSessions] = await Promise.all([
    prisma.conversationSession.findMany({
      take: halfLimit,
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
    }),
    prisma.scoutRun.findMany({
      take: halfLimit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        status: true,
        modelId: true,
        tokensInput: true,
        tokensOutput: true,
        tokensUsed: true,
        scout: {
          select: {
            name: true,
            userId: true,
            user: { select: { email: true, name: true } },
          },
        },
      },
    }),
  ]);

  // Normalize conversation sessions
  const convRows = sessions.map((s) => {
    const inputTokens = s.usageLogs.reduce((sum, l) => sum + l.inputTokens, 0);
    const outputTokens = s.usageLogs.reduce((sum, l) => sum + l.outputTokens, 0);
    return {
      id: s.id,
      createdAt: s.createdAt,
      source: s.source,
      modelUsed: s.modelUsed,
      user: s.user,
      totalTokens: inputTokens + outputTokens,
      costUsd: Math.round(estimateCost(s.modelUsed, inputTokens, outputTokens) * 100) / 100,
      messageCount: s._count.messages,
    };
  });

  // Normalize scout runs as sessions
  const scoutRows = scoutRunSessions.map((r) => {
    const input = r.tokensInput ?? 0;
    const output = r.tokensOutput ?? 0;
    return {
      id: r.id,
      createdAt: r.createdAt,
      source: `scout:${r.scout?.name ?? "unknown"}`,
      modelUsed: r.modelId ?? "",
      user: r.scout?.user ?? null,
      totalTokens: input + output,
      costUsd: Math.round(estimateCost(r.modelId, input, output) * 100) / 100,
      messageCount: null,
      scoutStatus: r.status,
    };
  });

  // Merge and sort by createdAt desc
  const merged = [...convRows, ...scoutRows]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  return c.json({ sessions: merged });
});
