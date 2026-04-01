import { Hono } from "hono";
import { prisma } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";
import { estimateCost } from "../lib/pricing.js";

export const dashboard = new Hono<AuthEnv>();

dashboard.get("/stats", async (c) => {
  // Use last 30 days instead of calendar month so there's always data
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    activeScouts,
    totalRuns,
    failedRuns,
    totalFindings,
    totalItems,
    tokenAgg,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.scout.count({ where: { status: "active" } }),
    prisma.scoutRun.count({ where: { status: "success", createdAt: { gte: since } } }),
    prisma.scoutRun.count({ where: { status: "failed", createdAt: { gte: since } } }),
    prisma.scoutFinding.count({ where: { createdAt: { gte: since } } }),
    prisma.item.count(),
    prisma.aIUsageLog.groupBy({
      by: ["model"],
      where: { createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);

  // Compute spend from aggregated data (no full table scan)
  let aiSpendUsd = 0;
  let totalTokens = 0;
  for (const group of tokenAgg) {
    const input = group._sum.inputTokens ?? 0;
    const output = group._sum.outputTokens ?? 0;
    aiSpendUsd += estimateCost(group.model, input, output);
    totalTokens += input + output;
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
