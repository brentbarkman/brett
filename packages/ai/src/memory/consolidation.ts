import { invalidateProfileCache } from "./user-profile.js";

const CONFIDENCE_DECAY = 0.05;
const MIN_CONFIDENCE = 0.1;
const STALE_DAYS = 90;

/**
 * Consolidate user memory: decay confidence on untouched facts,
 * and expire very old low-confidence facts.
 */
export async function consolidateUserMemory(
  userId: string,
  prisma: any, // Use any since ExtendedPrismaClient loses types through $extends
): Promise<{ decayed: number; expired: number; deduplicated: number }> {
  const now = new Date();
  const staleDate = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000);

  // 1. Decay confidence on facts not updated in 30+ days
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const decayResult = await prisma.$executeRaw`
    UPDATE "UserFact"
    SET confidence = GREATEST(confidence - ${CONFIDENCE_DECAY}, ${MIN_CONFIDENCE}),
        "updatedAt" = NOW()
    WHERE "userId" = ${userId}
      AND "validUntil" IS NULL
      AND "updatedAt" < ${thirtyDaysAgo}
      AND confidence > ${MIN_CONFIDENCE}
  `;

  // 2. Expire very old, low-confidence facts
  const expireResult = await prisma.$executeRaw`
    UPDATE "UserFact"
    SET "validUntil" = NOW()
    WHERE "userId" = ${userId}
      AND "validUntil" IS NULL
      AND confidence <= ${MIN_CONFIDENCE}
      AND "updatedAt" < ${staleDate}
  `;

  // 3. Deduplicate knowledge entities (merge same name, different case)
  // Find duplicate entities (same userId + type + lowercase name)
  const duplicates = (await prisma.$queryRaw`
    SELECT LOWER(name) AS lower_name, type, array_agg(id ORDER BY "createdAt" ASC) AS ids
    FROM "KnowledgeEntity"
    WHERE "userId" = ${userId}
    GROUP BY LOWER(name), type
    HAVING COUNT(*) > 1
  `) as Array<{ lower_name: string; type: string; ids: string[] }>;

  let deduplicated = 0;
  for (const dup of duplicates) {
    const [keepId, ...removeIds] = dup.ids;
    if (removeIds.length === 0) continue;

    // Move relationships from duplicates to the canonical entity
    for (const removeId of removeIds) {
      await prisma.$executeRaw`
        UPDATE "KnowledgeRelationship" SET "sourceId" = ${keepId} WHERE "sourceId" = ${removeId}
      `;
      await prisma.$executeRaw`
        UPDATE "KnowledgeRelationship" SET "targetId" = ${keepId} WHERE "targetId" = ${removeId}
      `;
      await prisma.$executeRaw`
        DELETE FROM "KnowledgeEntity" WHERE id = ${removeId}
      `;
      deduplicated++;
    }
  }

  // Invalidate cached user profile so next request rebuilds from updated facts
  invalidateProfileCache(userId);

  return { decayed: decayResult, expired: expireResult, deduplicated };
}

/**
 * Run consolidation for all users in batches.
 * Uses cursor-based pagination to avoid loading all users at once.
 */
export async function runConsolidation(prisma: any): Promise<void> {
  const batchSize = 100;
  let cursor: string | undefined;
  let processedUsers = 0;

  while (true) {
    const users = await prisma.user.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true },
      orderBy: { id: "asc" },
    });

    if (users.length === 0) break;

    for (const user of users) {
      try {
        const result = await consolidateUserMemory(user.id, prisma);
        if (result.decayed > 0 || result.expired > 0 || result.deduplicated > 0) {
          console.log(
            `[consolidation] User ${user.id}: decayed=${result.decayed}, expired=${result.expired}, deduped=${result.deduplicated}`,
          );
        }
      } catch (err) {
        console.error(`[consolidation] Failed for user ${user.id}:`, err);
      }
    }

    processedUsers += users.length;
    cursor = users[users.length - 1].id;

    if (users.length < batchSize) break;
  }

  console.log(`[consolidation] Complete: processed ${processedUsers} users`);
}
