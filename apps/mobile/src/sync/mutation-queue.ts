// ────────────────────────────────────────────────────────────────────────────
// Mutation Queue — persistent FIFO queue backed by _mutation_queue table
//
// Every local write (create, update, delete) enqueues a mutation here.
// The push engine drains this queue by sending batches to POST /sync/push.
// This module is the ONLY writer to _mutation_queue; all other sync
// components read from it or call these functions.
// ────────────────────────────────────────────────────────────────────────────

import { getDatabase } from "../db";
import { mutationQueue as mqTable } from "../db/schema";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import type { MutationRecord, MutationAction, MutationStatus } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a raw DB row into a typed MutationRecord. */
function rowToRecord(row: typeof mqTable.$inferSelect): MutationRecord {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action as MutationAction,
    endpoint: row.endpoint,
    method: row.method,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    changedFields: row.changedFields ? (JSON.parse(row.changedFields) as string[]) : undefined,
    previousValues: row.previousValues
      ? (JSON.parse(row.previousValues) as Record<string, unknown>)
      : undefined,
    baseUpdatedAt: row.baseUpdatedAt ?? undefined,
    beforeSnapshot: row.beforeSnapshot
      ? (JSON.parse(row.beforeSnapshot) as Record<string, unknown>)
      : undefined,
    dependsOn: row.dependsOn ?? undefined,
    batchId: row.batchId ?? undefined,
    status: row.status as MutationStatus,
    retryCount: row.retryCount,
    error: row.error ?? undefined,
    errorCode: row.errorCode ?? undefined,
    createdAt: row.createdAt,
  };
}

// ── Core Operations ──────────────────────────────────────────────────────────

type EnqueueInput = Omit<MutationRecord, "id" | "status" | "retryCount" | "createdAt">;

/**
 * Enqueue a new mutation. Sets status="pending", retryCount=0.
 * After inserting, runs eager compaction for the same entityId.
 * Returns the autoincrement ID assigned by SQLite.
 */
export function enqueue(mutation: EnqueueInput): number {
  const db = getDatabase();
  const now = new Date().toISOString();

  const result = db
    .insert(mqTable)
    .values({
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      action: mutation.action,
      endpoint: mutation.endpoint,
      method: mutation.method,
      payload: JSON.stringify(mutation.payload),
      changedFields: mutation.changedFields ? JSON.stringify(mutation.changedFields) : null,
      previousValues: mutation.previousValues ? JSON.stringify(mutation.previousValues) : null,
      baseUpdatedAt: mutation.baseUpdatedAt ?? null,
      beforeSnapshot: mutation.beforeSnapshot ? JSON.stringify(mutation.beforeSnapshot) : null,
      dependsOn: mutation.dependsOn ?? null,
      batchId: mutation.batchId ?? null,
      status: "pending",
      retryCount: 0,
      createdAt: now,
    })
    .returning({ id: mqTable.id })
    .get();

  // Eager compaction: merge consecutive mutations on the same entity
  compactEntity(mutation.entityId);

  return result.id;
}

// ── Compaction ───────────────────────────────────────────────────────────────

/**
 * Compact pending mutations for a specific entityId.
 * Merges consecutive mutations according to these rules:
 *   CREATE + UPDATE  -> merge into CREATE (absorb UPDATE payload/changedFields)
 *   CREATE + DELETE  -> remove both (net-zero)
 *   UPDATE + UPDATE  -> merge payload + changedFields, keep earliest beforeSnapshot
 *   UPDATE + DELETE  -> keep only DELETE
 */
function compactEntity(entityId: string): void {
  const db = getDatabase();

  const pending = db
    .select()
    .from(mqTable)
    .where(and(eq(mqTable.entityId, entityId), eq(mqTable.status, "pending")))
    .orderBy(asc(mqTable.id))
    .all();

  if (pending.length < 2) return;

  // Walk pairs from oldest to newest and merge
  let i = 0;
  while (i < pending.length - 1) {
    const a = pending[i]!;
    const b = pending[i + 1]!;
    const actionA = a.action as MutationAction;
    const actionB = b.action as MutationAction;

    if (actionA === "CREATE" && actionB === "UPDATE") {
      // Merge UPDATE payload into CREATE
      const payloadA = JSON.parse(a.payload) as Record<string, unknown>;
      const payloadB = JSON.parse(b.payload) as Record<string, unknown>;
      const merged = { ...payloadA, ...payloadB };

      const fieldsA = a.changedFields ? (JSON.parse(a.changedFields) as string[]) : [];
      const fieldsB = b.changedFields ? (JSON.parse(b.changedFields) as string[]) : [];
      const mergedFields = [...new Set([...fieldsA, ...fieldsB])];

      db.update(mqTable)
        .set({
          payload: JSON.stringify(merged),
          changedFields: JSON.stringify(mergedFields),
        })
        .where(eq(mqTable.id, a.id))
        .run();
      db.delete(mqTable).where(eq(mqTable.id, b.id)).run();

      // Remove b from the working array and recheck same index
      pending.splice(i + 1, 1);
      continue;
    }

    if (actionA === "CREATE" && actionB === "DELETE") {
      // Net-zero: remove both
      db.delete(mqTable).where(eq(mqTable.id, a.id)).run();
      db.delete(mqTable).where(eq(mqTable.id, b.id)).run();
      pending.splice(i, 2);
      // Don't advance — the next pair is now at position i
      if (i > 0) i--; // Re-check the previous pair in case it can now compact
      continue;
    }

    if (actionA === "UPDATE" && actionB === "UPDATE") {
      // Merge: combine payloads, union changedFields, keep A's beforeSnapshot
      const payloadA = JSON.parse(a.payload) as Record<string, unknown>;
      const payloadB = JSON.parse(b.payload) as Record<string, unknown>;
      const merged = { ...payloadA, ...payloadB };

      const fieldsA = a.changedFields ? (JSON.parse(a.changedFields) as string[]) : [];
      const fieldsB = b.changedFields ? (JSON.parse(b.changedFields) as string[]) : [];
      const mergedFields = [...new Set([...fieldsA, ...fieldsB])];

      // Keep A's previousValues (earliest snapshot of what the server had)
      // but merge B's previousValues for any NEW fields not in A
      let mergedPrev: Record<string, unknown> | null = null;
      if (a.previousValues || b.previousValues) {
        const prevA = a.previousValues ? (JSON.parse(a.previousValues) as Record<string, unknown>) : {};
        const prevB = b.previousValues ? (JSON.parse(b.previousValues) as Record<string, unknown>) : {};
        // For fields in B but not in A, use B's previous (that's the original server value)
        mergedPrev = { ...prevB, ...prevA };
      }

      db.update(mqTable)
        .set({
          payload: JSON.stringify(merged),
          changedFields: JSON.stringify(mergedFields),
          previousValues: mergedPrev ? JSON.stringify(mergedPrev) : a.previousValues,
          // Keep A's beforeSnapshot (earliest full snapshot)
          // Keep A's baseUpdatedAt (earliest base)
        })
        .where(eq(mqTable.id, a.id))
        .run();
      db.delete(mqTable).where(eq(mqTable.id, b.id)).run();

      pending.splice(i + 1, 1);
      continue;
    }

    if (actionA === "UPDATE" && actionB === "DELETE") {
      // Delete wins — remove the UPDATE, keep DELETE
      db.delete(mqTable).where(eq(mqTable.id, a.id)).run();
      pending.splice(i, 1);
      continue;
    }

    // No merge possible for this pair — advance
    i++;
  }
}

/**
 * Full compaction pass across all pending mutations, grouped by entityId.
 * Called before push to maximize merge opportunities.
 */
export function compact(): void {
  const db = getDatabase();

  // Get distinct entityIds with multiple pending mutations
  const entities = db
    .selectDistinct({ entityId: mqTable.entityId })
    .from(mqTable)
    .where(eq(mqTable.status, "pending"))
    .all();

  for (const { entityId } of entities) {
    compactEntity(entityId);
  }
}

// ── Query ────────────────────────────────────────────────────────────────────

/**
 * Return pending mutations in FIFO order (by id, which matches insert order).
 * Respects dependency ordering: if mutation B depends on mutation A,
 * A will appear before B regardless of their ids (though ids are monotonic,
 * so dependsOn should naturally be < the dependent's id).
 */
export function getPending(): MutationRecord[] {
  const db = getDatabase();

  const rows = db
    .select()
    .from(mqTable)
    .where(eq(mqTable.status, "pending"))
    .orderBy(asc(mqTable.id))
    .all();

  // Topological sort to respect dependsOn
  // Since IDs are autoincrement and dependsOn should always point to a lower ID,
  // FIFO order should already be correct. But we verify:
  const byId = new Map<number, MutationRecord>();
  const records = rows.map(rowToRecord);
  for (const r of records) byId.set(r.id, r);

  const sorted: MutationRecord[] = [];
  const visited = new Set<number>();

  function visit(record: MutationRecord) {
    if (visited.has(record.id)) return;
    visited.add(record.id);

    // Visit dependency first
    if (record.dependsOn != null) {
      const dep = byId.get(record.dependsOn);
      if (dep && !visited.has(dep.id)) {
        visit(dep);
      }
    }

    sorted.push(record);
  }

  for (const r of records) visit(r);

  return sorted;
}

// ── Status Transitions ───────────────────────────────────────────────────────

/** Remove a processed mutation from the queue. */
export function dequeue(id: number): void {
  const db = getDatabase();
  db.delete(mqTable).where(eq(mqTable.id, id)).run();
}

/** Mark a mutation as in-flight (being sent to server). */
export function markInFlight(id: number): void {
  const db = getDatabase();
  db.update(mqTable).set({ status: "in_flight" }).where(eq(mqTable.id, id)).run();
}

/** Mark a mutation as failed. Increments retryCount. */
export function markFailed(id: number, error: string, errorCode?: string): void {
  const db = getDatabase();
  db.update(mqTable)
    .set({
      status: "failed",
      error,
      errorCode: errorCode ?? null,
      retryCount: sql`${mqTable.retryCount} + 1`,
    })
    .where(eq(mqTable.id, id))
    .run();
}

/** Mark a mutation as dead (permanently failed, will not be retried). */
export function markDead(id: number, error: string): void {
  const db = getDatabase();
  db.update(mqTable)
    .set({ status: "dead", error })
    .where(eq(mqTable.id, id))
    .run();
}

/** Mark a mutation as blocked (depends on another mutation that failed). */
export function markBlocked(id: number): void {
  const db = getDatabase();
  db.update(mqTable).set({ status: "blocked" }).where(eq(mqTable.id, id)).run();
}

/**
 * On app start: reset any "in_flight" mutations back to "pending".
 * These were being sent when the app was killed mid-push.
 */
export function resetInFlight(): void {
  const db = getDatabase();
  db.update(mqTable)
    .set({ status: "pending" })
    .where(eq(mqTable.status, "in_flight"))
    .run();
}

/**
 * Reset a specific mutation back to "pending" (e.g., after a network error).
 * Unlike markFailed, this does NOT increment retryCount — network errors
 * should retry indefinitely.
 */
export function resetToPending(id: number): void {
  const db = getDatabase();
  db.update(mqTable).set({ status: "pending" }).where(eq(mqTable.id, id)).run();
}

// ── Counts ───────────────────────────────────────────────────────────────────

export function getPendingCount(): number {
  const db = getDatabase();
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(mqTable)
    .where(eq(mqTable.status, "pending"))
    .get();
  return result?.count ?? 0;
}

export function getDeadCount(): number {
  const db = getDatabase();
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(mqTable)
    .where(eq(mqTable.status, "dead"))
    .get();
  return result?.count ?? 0;
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * After successful push: clear beforeSnapshot and previousValues
 * to save storage space (spec A10).
 */
export function purgeBeforeSnapshots(mutationIds: number[]): void {
  if (mutationIds.length === 0) return;
  const db = getDatabase();
  db.update(mqTable)
    .set({ beforeSnapshot: null, previousValues: null })
    .where(inArray(mqTable.id, mutationIds))
    .run();
}
