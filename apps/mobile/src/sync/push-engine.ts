// ────────────────────────────────────────────────────────────────────────────
// Push Engine — flushes the mutation queue to the server
//
// Periodically called by the sync manager. Compacts mutations, takes a batch,
// POSTs to /sync/push, and processes the per-mutation results.
// ────────────────────────────────────────────────────────────────────────────

import { apiRequest, OfflineError, AuthExpiredError } from "../api/client";
import { getDatabase, getSQLite } from "../db";
import {
  items,
  lists,
  calendarEventNotes,
  calendarEvents,
  scouts,
  scoutFindings,
  brettMessages,
  attachments,
} from "../db/schema";
import * as queue from "./mutation-queue";
import { resolveConflict } from "./conflict-resolver";
import type { SyncPushRequest, SyncPushResponse } from "@brett/types";
import { eq, getTableName } from "drizzle-orm";
import type { SQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";

const BATCH_SIZE = 50;

// ── Entity Type -> Drizzle Table + ID column mapping ─────────────────────────
// Explicit map — every data table's `id` column is referenced directly.

interface EntityTableInfo {
  table: SQLiteTable;
  idColumn: SQLiteColumn;
}

const ENTITY_TABLE_MAP: Record<string, EntityTableInfo> = {
  item: { table: items, idColumn: items.id },
  list: { table: lists, idColumn: lists.id },
  calendar_event_note: { table: calendarEventNotes, idColumn: calendarEventNotes.id },
  calendar_event: { table: calendarEvents, idColumn: calendarEvents.id },
  scout: { table: scouts, idColumn: scouts.id },
  scout_finding: { table: scoutFindings, idColumn: scoutFindings.id },
  brett_message: { table: brettMessages, idColumn: brettMessages.id },
  attachment: { table: attachments, idColumn: attachments.id },
};

function getTableForEntity(entityType: string): EntityTableInfo | null {
  return ENTITY_TABLE_MAP[entityType] ?? null;
}

// ── Field Mapping ────────────────────────────────────────────────────────────

/**
 * Map server response fields (camelCase) to local SQLite column names (snake_case)
 * and set sync metadata columns.
 */
function mapServerRecord(
  entityType: string,
  serverRecord: Record<string, unknown>,
): Record<string, unknown> {
  // The server returns camelCase keys. Drizzle schema uses camelCase property
  // names that map to snake_case columns. We pass camelCase keys and let
  // Drizzle handle the mapping.
  const mapped: Record<string, unknown> = { ...serverRecord };

  // Set sync metadata
  mapped._syncStatus = "synced";
  mapped._lastError = null;
  if (serverRecord.updatedAt) {
    mapped._baseUpdatedAt = serverRecord.updatedAt as string;
  }

  return mapped;
}

// ── Local Record Operations ──────────────────────────────────────────────────

// camelCase -> snake_case (e.g., "dueDate" -> "due_date", "_syncStatus" -> "_sync_status")
function toSnakeCase(key: string): string {
  return key.replace(/([A-Z])/g, "_$1").toLowerCase();
}

/**
 * Update a local record with the server's authoritative state.
 * Uses raw SQL upsert since the server response has dynamic columns.
 * This is the only place that writes server state back to data tables
 * during push resolution.
 */
function updateLocalRecord(
  entityType: string,
  entityId: string,
  serverRecord: Record<string, unknown>,
): void {
  const tableInfo = getTableForEntity(entityType);
  if (!tableInfo) return;

  const mapped = mapServerRecord(entityType, serverRecord);
  mapped.id = entityId;

  // Build column/value pairs for the SET clause, using snake_case column names
  const entries = Object.entries(mapped).map(([k, v]) => ({
    col: toSnakeCase(k),
    val: v,
  }));

  if (entries.length === 0) return;

  const sqlite = getSQLite();
  const cols = entries.map((e) => `"${e.col}"`).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  const setClause = entries
    .filter((e) => e.col !== "id") // Don't update the PK
    .map((e) => `"${e.col}" = excluded."${e.col}"`)
    .join(", ");

  const tableName = getTableName(tableInfo.table);
  const values = entries.map((e) =>
    e.val === null || e.val === undefined ? null
    : typeof e.val === "object" ? JSON.stringify(e.val)
    : e.val,
  );

  sqlite.runSync(
    `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders})
     ON CONFLICT ("id") DO UPDATE SET ${setClause}`,
    values as any[],
  );
}

/** Delete a local record (entity was deleted on the server). */
function deleteLocalRecord(entityType: string, entityId: string): void {
  const tableInfo = getTableForEntity(entityType);
  if (!tableInfo) return;

  const db = getDatabase();
  db.delete(tableInfo.table).where(eq(tableInfo.idColumn, entityId)).run();
}

// ── Push ─────────────────────────────────────────────────────────────────────

export interface PushResult {
  pushed: number;
  failed: number;
}

/**
 * Flush pending mutations to the server.
 *
 * Flow:
 * 1. Compact mutations (merge same-entity mutations)
 * 2. Get pending mutations in dependency order
 * 3. Take a batch (max BATCH_SIZE)
 * 4. Mark all as in_flight
 * 5. POST /sync/push
 * 6. Process per-mutation results
 * 7. Purge snapshots for successful mutations
 *
 * Returns the count of pushed and failed mutations.
 * Throws AuthExpiredError if auth is expired (caller should handle).
 */
export async function push(): Promise<PushResult> {
  // 1. Compact
  queue.compact();

  // 2. Get pending
  const pending = queue.getPending();
  if (pending.length === 0) return { pushed: 0, failed: 0 };

  // 3. Take a batch
  const batch = pending.slice(0, BATCH_SIZE);

  // 4. Mark all as in_flight
  for (const m of batch) queue.markInFlight(m.id);

  // 5. Build request
  const request: SyncPushRequest = {
    mutations: batch.map((m) => ({
      idempotencyKey: String(m.id),
      entityType: m.entityType,
      entityId: m.entityId,
      action: m.action,
      payload: m.payload,
      changedFields: m.changedFields,
      previousValues: m.previousValues,
      baseUpdatedAt: m.baseUpdatedAt,
    })),
    protocolVersion: 1,
  };

  // 6. POST /sync/push
  try {
    const { data } = await apiRequest<SyncPushResponse>("/sync/push", {
      method: "POST",
      body: JSON.stringify(request),
    });

    // 7. Process results
    let pushed = 0;
    let failed = 0;
    const successIds: number[] = [];

    for (const result of data.results) {
      const mutation = batch.find((m) => String(m.id) === result.idempotencyKey);
      if (!mutation) continue;

      switch (result.status) {
        case "applied":
          // Clean apply — update local with server state
          if (result.record) {
            updateLocalRecord(mutation.entityType, mutation.entityId, result.record);
          }
          queue.dequeue(mutation.id);
          successIds.push(mutation.id);
          pushed++;
          break;

        case "merged":
          // Server merged our changes — some fields may have been overridden
          if (result.record) {
            updateLocalRecord(mutation.entityType, mutation.entityId, result.record);
          }
          if (result.conflictedFields?.length) {
            resolveConflict(
              mutation.entityType,
              mutation.entityId,
              mutation.id,
              mutation.payload,
              result.record ?? {},
              result.conflictedFields,
            );
          }
          queue.dequeue(mutation.id);
          successIds.push(mutation.id);
          pushed++;
          break;

        case "conflict":
          // Full conflict — server wins entirely, update local
          if (result.record) {
            updateLocalRecord(mutation.entityType, mutation.entityId, result.record);
          }
          resolveConflict(
            mutation.entityType,
            mutation.entityId,
            mutation.id,
            mutation.payload,
            result.record ?? {},
            result.conflictedFields ?? [],
          );
          queue.dequeue(mutation.id);
          successIds.push(mutation.id);
          pushed++;
          break;

        case "not_found":
          // Record was deleted on server — remove locally
          deleteLocalRecord(mutation.entityType, mutation.entityId);
          queue.dequeue(mutation.id);
          successIds.push(mutation.id);
          pushed++;
          break;

        case "error":
          // Permanent server error — dead letter
          queue.markDead(mutation.id, result.error ?? "Unknown server error");
          failed++;
          break;
      }
    }

    // Purge beforeSnapshot/previousValues for successfully pushed mutations
    queue.purgeBeforeSnapshots(successIds);

    return { pushed, failed };
  } catch (err) {
    if (err instanceof OfflineError) {
      // Network error — reset all to pending for retry
      // No retryCount increment: network errors retry indefinitely
      for (const m of batch) queue.resetToPending(m.id);
      return { pushed: 0, failed: 0 };
    }

    if (err instanceof AuthExpiredError) {
      // Auth expired — reset to pending, let auth flow handle it
      for (const m of batch) queue.resetToPending(m.id);
      throw err; // Propagate to caller
    }

    // Unexpected error — reset to pending and rethrow
    for (const m of batch) queue.resetToPending(m.id);
    throw err;
  }
}
