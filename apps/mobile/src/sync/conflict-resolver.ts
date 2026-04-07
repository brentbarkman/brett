// ────────────────────────────────────────────────────────────────────────────
// Conflict Resolver — logs and resolves conflicts from sync push results
//
// When the server reports a "merged" or "conflict" result, this module
// records the conflict in the _conflict_log table for debugging and
// determines the resolution strategy.
// ────────────────────────────────────────────────────────────────────────────

import { getDatabase } from "../db";
import { conflictLog } from "../db/schema";

type Resolution = "server_wins" | "merged";

/**
 * Log a conflict and determine resolution.
 *
 * Resolution strategy:
 * - If ALL changedFields were conflicted -> "server_wins"
 *   (every field we changed was also changed on server; server state prevails)
 * - If only SOME fields conflicted -> "merged"
 *   (server accepted our non-conflicting changes, overrode the rest)
 *
 * In both cases the server's record is applied locally. This log exists
 * for debugging and potential future user-facing conflict UI.
 */
export function resolveConflict(
  entityType: string,
  entityId: string,
  mutationId: number,
  localValues: Record<string, unknown>,
  serverValues: Record<string, unknown>,
  conflictedFields: string[],
): Resolution {
  const db = getDatabase();

  // Determine resolution
  const localFieldCount = Object.keys(localValues).length;
  const resolution: Resolution =
    conflictedFields.length > 0 && conflictedFields.length >= localFieldCount
      ? "server_wins"
      : "merged";

  db.insert(conflictLog)
    .values({
      entityType,
      entityId,
      mutationId,
      localValues: JSON.stringify(localValues),
      serverValues: JSON.stringify(serverValues),
      conflictedFields: JSON.stringify(conflictedFields),
      resolution,
      resolvedAt: new Date().toISOString(),
    })
    .run();

  return resolution;
}
