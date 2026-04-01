/**
 * Connection Health — Re-link Task Management
 *
 * When an external integration breaks (token revoked, key invalid, sync fails),
 * this module creates a task in the user's Today view prompting them to re-link.
 *
 * Pattern:
 *   - Detect failure at the call site (not a separate health-check cron)
 *   - Call createRelinkTask() with a human-readable reason
 *   - Dedup via sourceId: "relink:<type>:<accountId>" — one task per broken connection
 *   - On successful reconnect, call resolveRelinkTask() to auto-complete the task
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ FUTURE INTEGRATIONS: If you add a new external integration, you     │
 * │ MUST follow this pattern. Detect auth/sync failures at the call     │
 * │ site, call createRelinkTask with a clear reason, and call           │
 * │ resolveRelinkTask on successful reconnect. See existing call sites  │
 * │ in calendar-sync.ts, granola-sync.ts, middleware/ai.ts, and         │
 * │ scout-runner.ts.                                                    │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { prisma } from "./prisma.js";

type ConnectionType = "google-calendar" | "granola" | "ai";

const TITLES: Record<ConnectionType, string> = {
  "google-calendar": "Re-link Google Calendar",
  "granola": "Re-link Granola",
  "ai": "Re-link AI Provider",
};

function buildSourceId(type: ConnectionType, accountId: string): string {
  return `relink:${type}:${accountId}`;
}

/**
 * Create a re-link task in the user's Today view if one doesn't already exist.
 * The `reason` should explain what broke and what the user needs to do.
 */
export async function createRelinkTask(
  userId: string,
  type: ConnectionType,
  accountId: string,
  reason: string,
): Promise<void> {
  const sourceId = buildSourceId(type, accountId);

  // Dedup: skip if an active re-link task already exists for this connection
  const existing = await prisma.item.findFirst({
    where: {
      userId,
      source: "system",
      sourceId,
      status: { in: ["active", "snoozed"] },
    },
  });

  if (existing) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.item.create({
    data: {
      type: "task",
      title: TITLES[type] ?? `Re-link ${type}`,
      notes: reason,
      source: "system",
      sourceId,
      dueDate: today,
      dueDatePrecision: "day",
      status: "active",
      userId,
    },
  });
}

/**
 * Auto-complete re-link tasks when the connection is successfully restored.
 * Uses startsWith matching on sourceId so it resolves tasks regardless of
 * which specific accountId/configId created them (handles key rotation, re-auth).
 */
export async function resolveRelinkTask(
  userId: string,
  type: ConnectionType,
): Promise<void> {
  const prefix = `relink:${type}:`;

  await prisma.item.updateMany({
    where: {
      userId,
      source: "system",
      sourceId: { startsWith: prefix },
      status: { in: ["active", "snoozed"] },
    },
    data: {
      status: "done",
      completedAt: new Date(),
    },
  });
}
