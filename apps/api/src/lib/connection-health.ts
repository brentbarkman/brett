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

export type ConnectionType = "google-calendar" | "granola" | "ai";

export interface BrokenConnectionDetail {
  type: ConnectionType;
  accountId: string | null;
  reason: string | null;
  brokenSince: string;
}

export interface BrokenConnectionsResponse {
  count: number;
  types: string[];
  details: BrokenConnectionDetail[];
}

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
 *
 * Provider-wide resolver — use this for single-account integrations or for
 * cases where ANY account becoming healthy should clear the prompt. For
 * multi-account providers (Granola), prefer `resolveRelinkTaskForAccount`
 * so one account's re-auth doesn't silently dismiss another account's
 * pending re-link prompt.
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

/**
 * Aggregate every active/snoozed re-link task for a user into a structured
 * response. Each entry carries the connection type, the specific accountId
 * that broke, the human-readable reason (from Item.notes — written by
 * createRelinkTask), and when the prompt was first created.
 *
 * Returns `count` + `types` for backwards compatibility with older clients
 * that only consume the totals, plus the new `details` array for per-account
 * UI chrome.
 */
export async function getBrokenConnections(
  userId: string,
): Promise<BrokenConnectionsResponse> {
  const items = await prisma.item.findMany({
    where: {
      userId,
      source: "system",
      sourceId: { startsWith: "relink:" },
      status: { in: ["active", "snoozed"] },
    },
    select: { sourceId: true, notes: true, createdAt: true },
  });

  const details: BrokenConnectionDetail[] = items.map((item: { sourceId: string | null; notes: string | null; createdAt: Date }) => {
    // sourceId format: "relink:<type>:<accountId>" (accountId may be absent
    // for legacy single-account integrations — split handles both cases).
    const parts = (item.sourceId ?? "").split(":");
    const type = (parts[1] ?? "") as ConnectionType;
    const accountId = parts[2] ?? null;
    return {
      type,
      accountId,
      reason: item.notes ?? null,
      brokenSince: item.createdAt.toISOString(),
    };
  });

  const types = [...new Set(details.map((d) => d.type))];
  return { count: details.length, types, details };
}

/**
 * Auto-complete the re-link task for a specific accountId. Use this on
 * successful re-auth or voluntary disconnect of a multi-account provider
 * so other accounts' re-link prompts stay visible.
 */
export async function resolveRelinkTaskForAccount(
  userId: string,
  type: ConnectionType,
  accountId: string,
): Promise<void> {
  const sourceId = buildSourceId(type, accountId);

  await prisma.item.updateMany({
    where: {
      userId,
      source: "system",
      sourceId,
      status: { in: ["active", "snoozed"] },
    },
    data: {
      status: "done",
      completedAt: new Date(),
    },
  });
}
