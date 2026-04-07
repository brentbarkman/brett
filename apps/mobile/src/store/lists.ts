// ────────────────────────────────────────────────────────────────────────────
// Lists Store — Zustand store backed by SQLite + mutation queue
//
// Same write-through pattern as items store: optimistic update -> SQLite ->
// enqueue mutation -> schedule push.
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { getSQLite } from "../db";
import { enqueue } from "../sync/mutation-queue";
import { schedulePushDebounced } from "../sync/sync-manager";
import { generateCuid } from "@brett/utils";
import type { CreateListInput, UpdateListInput } from "@brett/types";

// ── Types ──────────────────────────────────────────────────────────────────

/** Flat record matching the lists SQLite table columns (camelCase). */
export interface ListRow {
  id: string;
  name: string;
  colorClass: string;
  sortOrder: number;
  archivedAt: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  _syncStatus: string;
  _baseUpdatedAt: string | null;
  _lastError: string | null;
}

interface ListsState {
  lists: ListRow[];

  // Hydration
  hydrate: () => void;

  // CRUD
  createList: (userId: string, input: CreateListInput) => string;
  updateList: (id: string, changes: UpdateListInput) => void;
  deleteList: (id: string) => void;

  // Sync callbacks
  upsertFromSync: (records: ListRow[]) => void;
  removeFromSync: (ids: string[]) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function rowToList(row: Record<string, unknown>): ListRow {
  return {
    id: row.id as string,
    name: row.name as string,
    colorClass: (row.color_class as string) ?? "bg-gray-500",
    sortOrder: (row.sort_order as number) ?? 0,
    archivedAt: (row.archived_at as string) ?? null,
    userId: row.user_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string) ?? null,
    _syncStatus: row._sync_status as string,
    _baseUpdatedAt: (row._base_updated_at as string) ?? null,
    _lastError: (row._last_error as string) ?? null,
  };
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useListsStore = create<ListsState>((set, get) => ({
  lists: [],

  hydrate: () => {
    const db = getSQLite();
    const rows = db.getAllSync(
      `SELECT * FROM lists WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC`,
    );
    set({
      lists: rows.map((row) => rowToList(row as Record<string, unknown>)),
    });
  },

  createList: (userId, input) => {
    const id = generateCuid();
    const now = new Date().toISOString();

    const record: ListRow = {
      id,
      name: input.name,
      colorClass: input.colorClass ?? "bg-gray-500",
      sortOrder: get().lists.length, // append at end
      archivedAt: null,
      userId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      _syncStatus: "pending",
      _baseUpdatedAt: null,
      _lastError: null,
    };

    // Write to SQLite
    const db = getSQLite();
    db.runSync(
      `INSERT INTO lists (
        "id", "name", "color_class", "sort_order", "user_id",
        "created_at", "updated_at", "_sync_status"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, record.name, record.colorClass, record.sortOrder, userId, now, now, "pending"],
    );

    // Update store
    set((state) => ({ lists: [...state.lists, record] }));

    enqueue({
      entityType: "list",
      entityId: id,
      action: "CREATE",
      endpoint: "/lists",
      method: "POST",
      payload: { name: input.name, colorClass: input.colorClass ?? "bg-gray-500" },
    });

    schedulePushDebounced();
    return id;
  },

  updateList: (id, changes) => {
    const list = get().lists.find((l) => l.id === id);
    if (!list) return;

    const now = new Date().toISOString();
    const changedFields: string[] = [];
    const previousValues: Record<string, unknown> = {};
    const payload: Record<string, unknown> = {};

    if (changes.name != null && changes.name !== list.name) {
      changedFields.push("name");
      previousValues.name = list.name;
      payload.name = changes.name;
    }
    if (changes.colorClass != null && changes.colorClass !== list.colorClass) {
      changedFields.push("colorClass");
      previousValues.colorClass = list.colorClass;
      payload.colorClass = changes.colorClass;
    }

    if (changedFields.length === 0) return;

    // Build SQLite SET clause
    const setClauses: string[] = [`"updated_at" = ?`, `"_sync_status" = 'pending'`];
    const values: (string | number | null)[] = [now];

    if (payload.name != null) {
      setClauses.push(`"name" = ?`);
      values.push(payload.name as string);
    }
    if (payload.colorClass != null) {
      setClauses.push(`"color_class" = ?`);
      values.push(payload.colorClass as string);
    }

    values.push(id);

    const db = getSQLite();
    db.runSync(
      `UPDATE lists SET ${setClauses.join(", ")} WHERE id = ?`,
      values,
    );

    // Update store
    set((state) => ({
      lists: state.lists.map((l) =>
        l.id === id
          ? {
              ...l,
              ...(changes.name != null ? { name: changes.name } : {}),
              ...(changes.colorClass != null ? { colorClass: changes.colorClass } : {}),
              updatedAt: now,
              _syncStatus: "pending",
            }
          : l,
      ),
    }));

    enqueue({
      entityType: "list",
      entityId: id,
      action: "UPDATE",
      endpoint: `/lists/${id}`,
      method: "PATCH",
      payload,
      changedFields,
      previousValues,
      baseUpdatedAt: list._baseUpdatedAt ?? list.updatedAt,
      beforeSnapshot: list as unknown as Record<string, unknown>,
    });

    schedulePushDebounced();
  },

  deleteList: (id) => {
    const list = get().lists.find((l) => l.id === id);
    if (!list) return;

    const now = new Date().toISOString();

    // Soft-delete in SQLite
    const db = getSQLite();
    db.runSync(
      `UPDATE lists SET deleted_at = ?, _sync_status = 'pending' WHERE id = ?`,
      [now, id],
    );

    // Remove from store
    set((state) => ({
      lists: state.lists.filter((l) => l.id !== id),
    }));

    enqueue({
      entityType: "list",
      entityId: id,
      action: "DELETE",
      endpoint: `/lists/${id}`,
      method: "DELETE",
      payload: { deletedAt: now },
      beforeSnapshot: list as unknown as Record<string, unknown>,
    });

    schedulePushDebounced();
  },

  upsertFromSync: (records) => {
    set((state) => {
      const listsById = new Map(state.lists.map((l) => [l.id, l]));
      for (const record of records) {
        if (record.deletedAt) {
          listsById.delete(record.id);
        } else {
          listsById.set(record.id, record);
        }
      }
      return {
        lists: Array.from(listsById.values()).sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        ),
      };
    });
  },

  removeFromSync: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({
      lists: state.lists.filter((l) => !idSet.has(l.id)),
    }));
  },
}));
