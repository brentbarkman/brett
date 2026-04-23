import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";
import { Prisma } from "@brett/api-core";

/**
 * Identifier unique to this process — used so we can tell "I already hold
 * the lease, renew it" apart from "another replica holds it, skip".
 * Derived from pid + a random tag so two workers on the same host still
 * get distinct holders.
 */
const INSTANCE_ID = `${process.pid}:${randomUUID().slice(0, 8)}`;

/**
 * Try to take or extend a lease on `jobName` for `leaseMs` milliseconds.
 * Returns true if we got the lease, false if someone else already holds it.
 *
 * Safe to call from multiple replicas concurrently — the DB primary-key
 * constraint serializes the contention. The first replica's upsert wins;
 * subsequent replicas see an unexpired lease and bail.
 */
export async function tryAcquireCronLock(
  jobName: string,
  leaseMs: number,
): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseMs);

  try {
    // Atomic: succeeds if (a) no row exists, or (b) the row's lease has expired,
    // or (c) we already hold it and are extending.
    const result = await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "CronLock" ("jobName", "holder", "acquiredAt", "expiresAt", "updatedAt")
      VALUES (${jobName}, ${INSTANCE_ID}, ${now}, ${expiresAt}, ${now})
      ON CONFLICT ("jobName") DO UPDATE
        SET "holder" = EXCLUDED."holder",
            "acquiredAt" = EXCLUDED."acquiredAt",
            "expiresAt" = EXCLUDED."expiresAt",
            "updatedAt" = EXCLUDED."updatedAt"
        WHERE "CronLock"."expiresAt" < ${now}
           OR "CronLock"."holder" = ${INSTANCE_ID}
    `);
    return result === 1;
  } catch (err) {
    console.error(`[cron-lock] acquire failed for ${jobName}:`, err);
    return false;
  }
}

/**
 * Release the lease early. Safe — only deletes if we still hold it. If we
 * crashed mid-job, the lease expires naturally and another replica picks
 * it up on the next tick.
 */
export async function releaseCronLock(jobName: string): Promise<void> {
  try {
    await prisma.cronLock.deleteMany({
      where: { jobName, holder: INSTANCE_ID },
    });
  } catch (err) {
    console.error(`[cron-lock] release failed for ${jobName}:`, err);
  }
}

/**
 * Run `fn` under a distributed lease. Combines acquire + auto-release so
 * callers don't have to remember the cleanup.
 */
export async function withCronLock<T>(
  jobName: string,
  leaseMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const acquired = await tryAcquireCronLock(jobName, leaseMs);
  if (!acquired) return null;
  try {
    return await fn();
  } finally {
    await releaseCronLock(jobName);
  }
}
