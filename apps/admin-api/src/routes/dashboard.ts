import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";

// Per-model pricing in USD per 1M tokens (input / output)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-3-20240307": { input: 0.25, output: 1.25 },
  "claude-3-5-haiku-20241022": { input: 1.0, output: 5.0 },
};
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

export const dashboard = new Hono<AuthEnv>();

dashboard.get("/stats", async (c) => {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [
    totalUsers,
    activeScouts,
    totalRuns,
    failedRuns,
    totalFindings,
    usageLogs,
    totalItems,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.scout.count({ where: { status: "active" } }),
    prisma.scoutRun.count({ where: { status: "success", createdAt: { gte: startOfMonth } } }),
    prisma.scoutRun.count({ where: { status: "failed", createdAt: { gte: startOfMonth } } }),
    prisma.scoutFinding.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.aIUsageLog.findMany({
      where: { createdAt: { gte: startOfMonth } },
      select: { model: true, inputTokens: true, outputTokens: true },
    }),
    prisma.item.count(),
  ]);

  let aiSpendUsd = 0;
  let totalTokens = 0;
  for (const log of usageLogs) {
    const pricing = MODEL_PRICING[log.model ?? ""] ?? DEFAULT_PRICING;
    aiSpendUsd += (log.inputTokens * pricing.input + log.outputTokens * pricing.output) / 1_000_000;
    totalTokens += log.inputTokens + log.outputTokens;
  }

  const totalAttempts = totalRuns + failedRuns;
  const errorRate = totalAttempts > 0 ? failedRuns / totalAttempts : 0;

  return c.json({
    totalUsers,
    totalItems,
    activeScouts,
    scoutRunsThisMonth: totalRuns,
    scoutFailuresThisMonth: failedRuns,
    scoutErrorRate: Math.round(errorRate * 1000) / 1000,
    findingsThisMonth: totalFindings,
    aiSpendUsd: Math.round(aiSpendUsd * 100) / 100,
    aiTokensThisMonth: totalTokens,
  });
});
