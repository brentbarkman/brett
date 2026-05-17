// Dirty-bit triggers for the briefing pipeline. These do NOT run the
// pipeline themselves — they just mark the row dirty. The next client
// POST /refresh (after Today-view focus / app foreground) materializes
// the new brief. See
// docs/superpowers/specs/2026-05-16-briefing-pipeline-v2-design.md.

import { prisma } from "../prisma.js";
import type { TriggerSource } from "./types.js";

/**
 * Mark a user's briefing as dirty. Cheap, idempotent — repeated calls
 * within seconds are fine; the pipeline's 30-min floor handles the
 * actual cost containment.
 *
 * If the user has no UserBriefing row yet, this no-ops. Bootstrapping
 * the first row happens lazily on the first /refresh call.
 */
export async function markBriefingDirty(
  userId: string,
  source: TriggerSource,
): Promise<void> {
  try {
    await prisma.userBriefing.updateMany({
      where: { userId },
      data: { dirtyAt: new Date(), lastTriggerSource: source },
    });
  } catch (err) {
    // Triggers must never throw into their hosts (webhook handlers,
    // ingest pipelines, scanners). The brief just won't refresh — not
    // catastrophic.
    console.error(
      `[briefing-triggers] markBriefingDirty failed for ${userId} (${source}):`,
      err,
    );
  }
}

/**
 * Convenience: mark dirty for many users at once. Used by the morning
 * bootstrap cron which iterates users whose local time crosses 6:55am.
 */
export async function markManyBriefingsDirty(
  userIds: string[],
  source: TriggerSource,
): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await prisma.userBriefing.updateMany({
      where: { userId: { in: userIds } },
      data: { dirtyAt: new Date(), lastTriggerSource: source },
    });
  } catch (err) {
    console.error(
      `[briefing-triggers] markManyBriefingsDirty failed (${source}):`,
      err,
    );
  }
}
