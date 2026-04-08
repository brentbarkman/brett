// ────────────────────────────────────────────────────────────────────────────
// Pull Engine — fetches server changes via POST /sync/pull
//
// Called by the sync manager after push completes. Reads per-table cursors,
// sends them to the server, and applies upserts/deletes locally. Respects
// local pending mutations (won't clobber _syncStatus != "synced").
// ────────────────────────────────────────────────────────────────────────────

import { apiRequest } from "../api/client";
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
  syncCursors,
} from "../db/schema";
import type {
  SyncPullRequest,
  SyncPullResponse,
  SyncTable,
} from "@brett/types";
import { SYNC_TABLES } from "@brett/types";
import { eq, getTableName } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

// ── Table Name -> Drizzle Table mapping ─────────────────────────────────────

const SYNC_TABLE_MAP: Record<SyncTable, SQLiteTable> = {
  items,
  lists,
  calendar_events: calendarEvents,
  calendar_event_notes: calendarEventNotes,
  scouts,
  scout_findings: scoutFindings,
  brett_messages: brettMessages,
  attachments,
};

// ── Field Mapping ───────────────────────────────────────────────────────────

// camelCase -> snake_case (e.g., "dueDate" -> "due_date", "_syncStatus" -> "_sync_status")
function toSnakeCase(key: string): string {
  return key.replace(/([A-Z])/g, "_$1").toLowerCase();
}

// ── Record Operations ───────────────────────────────────────────────────────

/**
 * Upsert a server record into the local SQLite table.
 *
 * Key rule: only overwrite if _sync_status is "synced". If the local record
 * has _sync_status = "pending_*" or anything other than "synced", we skip
 * the upsert to avoid clobbering uncommitted local changes.
 */
function upsertRecord(
  tableName: SyncTable,
  record: Record<string, unknown>,
): void {
  const sqlite = getSQLite();
  const sqliteTableName = getTableName(SYNC_TABLE_MAP[tableName]);

  // Map the server record to local columns
  const mapped: Record<string, unknown> = { ...record };
  mapped._syncStatus = "synced";
  mapped._lastError = null;
  if (record.updatedAt) {
    mapped._baseUpdatedAt = record.updatedAt as string;
  }

  const id = mapped.id as string;
  if (!id) return;

  // Check if there's a local record with pending changes — don't clobber it
  const existing = sqlite.getFirstSync<{ _sync_status: string }>(
    `SELECT "_sync_status" FROM "${sqliteTableName}" WHERE "id" = ?`,
    [id],
  );

  if (existing && existing._sync_status !== "synced") {
    // Local record has pending changes — skip server overwrite
    return;
  }

  // Build column/value pairs using snake_case column names
  const entries = Object.entries(mapped).map(([k, v]) => ({
    col: toSnakeCase(k),
    val: v,
  }));

  if (entries.length === 0) return;

  const cols = entries.map((e) => `"${e.col}"`).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  const setClause = entries
    .filter((e) => e.col !== "id")
    .map((e) => `"${e.col}" = excluded."${e.col}"`)
    .join(", ");

  const values = entries.map((e) =>
    e.val === null || e.val === undefined
      ? null
      : typeof e.val === "object"
        ? JSON.stringify(e.val)
        : e.val,
  );

  sqlite.runSync(
    `INSERT INTO "${sqliteTableName}" (${cols}) VALUES (${placeholders})
     ON CONFLICT ("id") DO UPDATE SET ${setClause}`,
    values as (string | number | null)[],
  );
}

/** Delete a record from the local table by ID. */
function deleteLocalRecord(tableName: SyncTable, id: string): void {
  const sqlite = getSQLite();
  const sqliteTableName = getTableName(SYNC_TABLE_MAP[tableName]);

  sqlite.runSync(`DELETE FROM "${sqliteTableName}" WHERE "id" = ?`, [id]);
}

/**
 * Replace provisional records with server records.
 *
 * When items are created locally and then confirmed by the server, the server
 * record may have a different ID. Provisionals are identified by
 * `_provisional_parent_id` matching the server record's ID.
 */
function replaceProvisionals(upsertedRecords: Record<string, unknown>[]): void {
  if (upsertedRecords.length === 0) return;

  const sqlite = getSQLite();
  const tableName = getTableName(items);

  for (const record of upsertedRecords) {
    const serverId = record.id as string;
    if (!serverId) continue;

    // Find any provisional that references this server record
    sqlite.runSync(
      `DELETE FROM "${tableName}" WHERE "_provisional_parent_id" = ?`,
      [serverId],
    );
  }
}

/** Insert or update the cursor for a sync table. */
function upsertCursor(tableName: string, cursor: string): void {
  const sqlite = getSQLite();

  sqlite.runSync(
    `INSERT INTO "_sync_cursors" ("table_name", "last_synced_at", "is_initial_sync_complete")
     VALUES (?, ?, 1)
     ON CONFLICT ("table_name") DO UPDATE SET "last_synced_at" = excluded."last_synced_at", "is_initial_sync_complete" = 1`,
    [tableName, cursor],
  );
}

// ── Pull ────────────────────────────────────────────────────────────────────

export interface PullResult {
  recordsUpserted: number;
  recordsDeleted: number;
}

/**
 * Fetch changes from the server and apply them locally.
 *
 * Flow:
 * 1. Read per-table cursors from _sync_cursors
 * 2. POST /sync/pull with cursors
 * 3. Handle fullSyncRequired (clear cursors for re-pull)
 * 4. Apply upserts and deletes per table
 * 5. Replace provisional records (items only)
 * 6. Update cursors
 */
export async function pull(): Promise<PullResult> {
  const db = getDatabase();

  // 1. Read cursors
  const cursors: Record<string, string | null> = {};
  for (const table of SYNC_TABLES) {
    const row = db
      .select()
      .from(syncCursors)
      .where(eq(syncCursors.tableName, table))
      .get();
    cursors[table] = row?.lastSyncedAt ?? null;
  }

  // 2. POST /sync/pull
  const { status, data } = await apiRequest<SyncPullResponse>("/sync/pull", {
    method: "POST",
    body: JSON.stringify({
      cursors,
      protocolVersion: 1,
    } satisfies SyncPullRequest),
  });

  if (status !== 200 || !data) {
    throw new Error(`Sync pull failed: HTTP ${status}`);
  }

  // 3. Handle fullSyncRequired — clear all cursors, next pull will be a full sync
  if (data.fullSyncRequired) {
    const sqlite = getSQLite();
    sqlite.runSync(`DELETE FROM "_sync_cursors"`);
    return { recordsUpserted: 0, recordsDeleted: 0 };
  }

  // 4. Process changes per table
  let totalUpserted = 0;
  let totalDeleted = 0;

  for (const table of SYNC_TABLES) {
    const changes = data.changes[table];
    if (!changes) continue;

    // Upsert records (respects local pending — won't clobber)
    for (const record of changes.upserted) {
      upsertRecord(table, record as Record<string, unknown>);
      totalUpserted++;
    }

    // Delete tombstones
    for (const deletedId of changes.deleted) {
      deleteLocalRecord(table, deletedId);
      totalDeleted++;
    }

    // Replace provisionals for items table
    if (table === "items") {
      replaceProvisionals(changes.upserted as Record<string, unknown>[]);
    }
  }

  // 5. Update cursors
  for (const [table, cursor] of Object.entries(data.cursors)) {
    upsertCursor(table, cursor);
  }

  return { recordsUpserted: totalUpserted, recordsDeleted: totalDeleted };
}
