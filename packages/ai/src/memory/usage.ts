import type { PrismaClient } from "@prisma/client";

export interface UsageEntry {
  userId: string;
  sessionId?: string;
  provider: string;
  model: string;
  modelTier: string;
  source: string;
  inputTokens: number;
  outputTokens: number;
}

export async function logUsage(prisma: PrismaClient, entry: UsageEntry): Promise<void> {
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
    },
  }).catch((err) => console.error("[usage-log] Failed:", err.message));
}
