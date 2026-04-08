// ────────────────────────────────────────────────────────────────────────────
// Items Store — Zustand store backed by SQLite + mutation queue
//
// All writes follow: update store (optimistic) -> write SQLite -> enqueue
// mutation -> schedule push. Sync callbacks (upsertFromSync, removeFromSync)
// update the store after the pull engine writes to SQLite.
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { getSQLite } from "../db";
import { enqueue } from "../sync/mutation-queue";
import { schedulePushDebounced } from "../sync/sync-manager";
import { generateCuid } from "@brett/utils";
import type { CreateItemInput, UpdateItemInput } from "@brett/types";

// ── Types ──────────────────────────────────────────────────────────────────

/** Flat record matching the items SQLite table columns (camelCase). */
export interface ItemRow {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string | null;
  notes: string | null;
  source: string;
  sourceId: string | null;
  sourceUrl: string | null;
  dueDate: string | null;
  dueDatePrecision: string | null;
  completedAt: string | null;
  snoozedUntil: string | null;
  brettObservation: string | null;
  reminder: string | null;
  recurrence: string | null;
  recurrenceRule: string | null;
  brettTakeGeneratedAt: string | null;
  contentType: string | null;
  contentStatus: string | null;
  contentTitle: string | null;
  contentBody: string | null;
  contentDescription: string | null;
  contentImageUrl: string | null;
  contentFavicon: string | null;
  contentDomain: string | null;
  listId: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  _syncStatus: string;
  _baseUpdatedAt: string | null;
  _lastError: string | null;
  _provisionalParentId: string | null;
}

interface ItemsState {
  items: Map<string, ItemRow>;

  // Hydration — load all active items from SQLite into memory
  hydrate: () => void;

  // CRUD — all write through SQLite + mutation queue
  createItem: (userId: string, input: CreateItemInput) => string;
  toggleItem: (id: string) => void;
  updateItem: (id: string, changes: UpdateItemInput) => void;
  deleteItem: (id: string) => void;

  // Sync callbacks — called by pull engine after SQLite writes
  upsertFromSync: (records: ItemRow[]) => void;
  removeFromSync: (ids: string[]) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Map a raw SQLite row (snake_case) to an ItemRow (camelCase). */
function rowToItem(row: Record<string, unknown>): ItemRow {
  return {
    id: row.id as string,
    type: row.type as string,
    status: row.status as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    notes: (row.notes as string) ?? null,
    source: row.source as string,
    sourceId: (row.source_id as string) ?? null,
    sourceUrl: (row.source_url as string) ?? null,
    dueDate: (row.due_date as string) ?? null,
    dueDatePrecision: (row.due_date_precision as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    snoozedUntil: (row.snoozed_until as string) ?? null,
    brettObservation: (row.brett_observation as string) ?? null,
    reminder: (row.reminder as string) ?? null,
    recurrence: (row.recurrence as string) ?? null,
    recurrenceRule: (row.recurrence_rule as string) ?? null,
    brettTakeGeneratedAt: (row.brett_take_generated_at as string) ?? null,
    contentType: (row.content_type as string) ?? null,
    contentStatus: (row.content_status as string) ?? null,
    contentTitle: (row.content_title as string) ?? null,
    contentBody: (row.content_body as string) ?? null,
    contentDescription: (row.content_description as string) ?? null,
    contentImageUrl: (row.content_image_url as string) ?? null,
    contentFavicon: (row.content_favicon as string) ?? null,
    contentDomain: (row.content_domain as string) ?? null,
    listId: (row.list_id as string) ?? null,
    userId: row.user_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    deletedAt: (row.deleted_at as string) ?? null,
    _syncStatus: row._sync_status as string,
    _baseUpdatedAt: (row._base_updated_at as string) ?? null,
    _lastError: (row._last_error as string) ?? null,
    _provisionalParentId: (row._provisional_parent_id as string) ?? null,
  };
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useItemsStore = create<ItemsState>((set, get) => ({
  items: new Map(),

  hydrate: () => {
    const db = getSQLite();
    const rows = db.getAllSync(
      `SELECT * FROM items WHERE _sync_status != 'pending_delete' AND deleted_at IS NULL`,
    );
    const map = new Map<string, ItemRow>();
    for (const row of rows) {
      const item = rowToItem(row as Record<string, unknown>);
      map.set(item.id, item);
    }
    set({ items: map });
  },

  createItem: (userId, input) => {
    const id = generateCuid();
    const now = new Date().toISOString();

    const record: ItemRow = {
      id,
      type: input.type,
      status: input.status ?? "active",
      title: input.title,
      description: input.description ?? null,
      notes: null,
      source: input.source ?? "Brett",
      sourceId: input.sourceId ?? null,
      sourceUrl: input.sourceUrl ?? null,
      dueDate: input.dueDate ?? null,
      dueDatePrecision: input.dueDatePrecision ?? null,
      completedAt: null,
      snoozedUntil: null,
      brettObservation: input.brettObservation ?? null,
      reminder: null,
      recurrence: null,
      recurrenceRule: null,
      brettTakeGeneratedAt: null,
      contentType: input.contentType ?? null,
      contentStatus: null,
      contentTitle: null,
      contentBody: null,
      contentDescription: null,
      contentImageUrl: null,
      contentFavicon: null,
      contentDomain: null,
      listId: input.listId ?? null,
      userId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      _syncStatus: "pending",
      _baseUpdatedAt: null,
      _lastError: null,
      _provisionalParentId: null,
    };

    // Write to SQLite
    const db = getSQLite();
    db.runSync(
      `INSERT INTO items (
        "id", "type", "status", "title", "description", "source", "source_id",
        "source_url", "due_date", "due_date_precision", "brett_observation",
        "content_type", "list_id", "user_id", "created_at", "updated_at",
        "_sync_status"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, record.type, record.status, record.title, record.description,
        record.source, record.sourceId, record.sourceUrl, record.dueDate,
        record.dueDatePrecision, record.brettObservation, record.contentType,
        record.listId, userId, now, now, "pending",
      ],
    );

    // Update store optimistically
    set((state) => {
      const items = new Map(state.items);
      items.set(id, record);
      return { items };
    });

    // Build mutation payload (only fields the server needs)
    const payload: Record<string, unknown> = {
      type: input.type,
      title: input.title,
      status: input.status ?? "active",
    };
    if (input.description != null) payload.description = input.description;
    if (input.source != null) payload.source = input.source;
    if (input.sourceUrl != null) payload.sourceUrl = input.sourceUrl;
    if (input.dueDate != null) payload.dueDate = input.dueDate;
    if (input.dueDatePrecision != null) payload.dueDatePrecision = input.dueDatePrecision;
    if (input.brettObservation != null) payload.brettObservation = input.brettObservation;
    if (input.listId != null) payload.listId = input.listId;
    if (input.contentType != null) payload.contentType = input.contentType;
    if (input.sourceId != null) payload.sourceId = input.sourceId;

    enqueue({
      entityType: "item",
      entityId: id,
      action: "CREATE",
      endpoint: "/things",
      method: "POST",
      payload,
    });

    schedulePushDebounced();
    return id;
  },

  toggleItem: (id) => {
    const item = get().items.get(id);
    if (!item) return;

    const newStatus = item.status === "done" ? "active" : "done";
    const now = new Date().toISOString();
    const newCompletedAt = newStatus === "done" ? now : null;
    const previousValues: Record<string, unknown> = {
      status: item.status,
      completedAt: item.completedAt,
    };

    // Write to SQLite
    const db = getSQLite();
    db.runSync(
      `UPDATE items SET status = ?, completed_at = ?, updated_at = ?, _sync_status = 'pending' WHERE id = ?`,
      [newStatus, newCompletedAt, now, id],
    );

    // Update store optimistically
    set((state) => {
      const items = new Map(state.items);
      items.set(id, {
        ...item,
        status: newStatus,
        completedAt: newCompletedAt,
        updatedAt: now,
        _syncStatus: "pending",
      });
      return { items };
    });

    enqueue({
      entityType: "item",
      entityId: id,
      action: "UPDATE",
      endpoint: `/things/${id}`,
      method: "PATCH",
      payload: { status: newStatus, completedAt: newCompletedAt },
      changedFields: ["status", "completedAt"],
      previousValues,
      baseUpdatedAt: item._baseUpdatedAt ?? item.updatedAt,
      beforeSnapshot: item as unknown as Record<string, unknown>,
    });

    schedulePushDebounced();
  },

  updateItem: (id, changes) => {
    const item = get().items.get(id);
    if (!item) return;

    const now = new Date().toISOString();

    // Build the set of changed fields and their previous values
    const changedFields: string[] = [];
    const previousValues: Record<string, unknown> = {};
    const updatedItem = { ...item, updatedAt: now, _syncStatus: "pending" as const };

    // Use a plain-object view for dynamic key access
    const itemRecord = item as unknown as Record<string, unknown>;
    const mutableItem = updatedItem as unknown as Record<string, unknown>;

    for (const [key, value] of Object.entries(changes)) {
      if (itemRecord[key] !== value) {
        changedFields.push(key);
        previousValues[key] = itemRecord[key];
        mutableItem[key] = value;
      }
    }

    if (changedFields.length === 0) return;

    // Build SQLite SET clause dynamically (snake_case columns)
    const setClauses: string[] = [`"updated_at" = ?`, `"_sync_status" = 'pending'`];
    const values: (string | number | null)[] = [now];

    const camelToSnake: Record<string, string> = {
      title: "title",
      description: "description",
      notes: "notes",
      status: "status",
      dueDate: "due_date",
      dueDatePrecision: "due_date_precision",
      snoozedUntil: "snoozed_until",
      brettObservation: "brett_observation",
      listId: "list_id",
      reminder: "reminder",
      recurrence: "recurrence",
      recurrenceRule: "recurrence_rule",
      contentType: "content_type",
      contentStatus: "content_status",
      contentTitle: "content_title",
      contentDescription: "content_description",
      contentImageUrl: "content_image_url",
      contentBody: "content_body",
      contentFavicon: "content_favicon",
      contentDomain: "content_domain",
      sourceUrl: "source_url",
      source: "source",
    };

    for (const field of changedFields) {
      const col = camelToSnake[field];
      if (!col) continue;
      setClauses.push(`"${col}" = ?`);
      values.push((changes as Record<string, unknown>)[field] as string | number | null ?? null);
    }

    values.push(id);

    const db = getSQLite();
    db.runSync(
      `UPDATE items SET ${setClauses.join(", ")} WHERE id = ?`,
      values,
    );

    // Update store optimistically
    set((state) => {
      const items = new Map(state.items);
      items.set(id, updatedItem);
      return { items };
    });

    enqueue({
      entityType: "item",
      entityId: id,
      action: "UPDATE",
      endpoint: `/things/${id}`,
      method: "PATCH",
      payload: changes as Record<string, unknown>,
      changedFields,
      previousValues,
      baseUpdatedAt: item._baseUpdatedAt ?? item.updatedAt,
      beforeSnapshot: item as unknown as Record<string, unknown>,
    });

    schedulePushDebounced();
  },

  deleteItem: (id) => {
    const item = get().items.get(id);
    if (!item) return;

    const now = new Date().toISOString();

    // Soft-delete in SQLite
    const db = getSQLite();
    db.runSync(
      `UPDATE items SET deleted_at = ?, _sync_status = 'pending' WHERE id = ?`,
      [now, id],
    );

    // Remove from store
    set((state) => {
      const items = new Map(state.items);
      items.delete(id);
      return { items };
    });

    enqueue({
      entityType: "item",
      entityId: id,
      action: "DELETE",
      endpoint: `/things/${id}`,
      method: "DELETE",
      payload: { deletedAt: now },
      beforeSnapshot: item as unknown as Record<string, unknown>,
    });

    schedulePushDebounced();
  },

  upsertFromSync: (records) => {
    set((state) => {
      const items = new Map(state.items);
      for (const record of records) {
        // Only add to in-memory store if not soft-deleted
        if (record.deletedAt) {
          items.delete(record.id);
        } else {
          items.set(record.id, record);
        }
      }
      return { items };
    });
  },

  removeFromSync: (ids) => {
    set((state) => {
      const items = new Map(state.items);
      for (const id of ids) items.delete(id);
      return { items };
    });
  },
}));
