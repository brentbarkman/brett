import type { ExtendedPrismaClient } from "@brett/api-core";

export interface UsageEntry {
  userId: string;
  sessionId?: string;
  provider: string;
  model: string;
  modelTier: string;
  source: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export async function logUsage(prisma: ExtendedPrismaClient, entry: UsageEntry): Promise<void> {
  await prisma.aIUsageLog.create({
    data: {
      userId: entry.userId,
      sessionId: entry.sessionId,
      provider: entry.provider,
      model: entry.model,
      modelTier: entry.modelTier,
      source: entry.source,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheCreationTokens: entry.cacheCreationTokens ?? 0,
      cacheReadTokens: entry.cacheReadTokens ?? 0,
    },
  }).catch((err) => console.error("[usage-log] Failed:", err.message));
}
