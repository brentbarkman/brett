// ────────────────────────────────────────────────────────────────────────────
// useItems — React hook for item data + actions
//
// Thin wrapper around the Zustand items store. Provides memoized filtered
// views (todayItems, inboxItems) and actions (createItem, toggleItem, etc).
// ────────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { useItemsStore } from "../store/items";
import type { ItemRow } from "../store/items";
import type { CreateItemInput, UpdateItemInput, ItemStatus } from "@brett/types";
import { useAuth } from "../auth/provider";

export function useItems() {
  const items = useItemsStore((s) => s.items);
  const createItemAction = useItemsStore((s) => s.createItem);
  const toggleItem = useItemsStore((s) => s.toggleItem);
  const updateItem = useItemsStore((s) => s.updateItem);
  const deleteItem = useItemsStore((s) => s.deleteItem);
  const { userId } = useAuth();

  /** Create an item, injecting the current userId. */
  const createItem = useMemo(() => {
    return (input: CreateItemInput): string | null => {
      if (!userId) return null;
      return createItemAction(userId, input);
    };
  }, [userId, createItemAction]);

  /** All active items (not done, not archived), sorted by creation date desc. */
  const activeItems = useMemo(() => {
    return Array.from(items.values())
      .filter((item) => item.status === "active")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [items]);

  /**
   * Today view items: active + done items (not archived/snoozed).
   * Done items sort to the bottom.
   */
  const todayItems = useMemo(() => {
    return Array.from(items.values())
      .filter((item) => {
        const s = item.status as ItemStatus;
        return s === "active" || s === "done";
      })
      .sort((a, b) => {
        // Done items at bottom
        if (a.status === "done" && b.status !== "done") return 1;
        if (a.status !== "done" && b.status === "done") return -1;
        // Within same status: sort by creation date (newest first)
        return b.createdAt.localeCompare(a.createdAt);
      });
  }, [items]);

  /** Items for a specific list. */
  const getListItems = useMemo(() => {
    return (listId: string): ItemRow[] =>
      Array.from(items.values())
        .filter((item) => item.listId === listId && item.status !== "archived")
        .sort((a, b) => {
          if (a.status === "done" && b.status !== "done") return 1;
          if (a.status !== "done" && b.status === "done") return -1;
          return b.createdAt.localeCompare(a.createdAt);
        });
  }, [items]);

  /** Get a single item by ID. */
  const getItem = useMemo(() => {
    return (id: string): ItemRow | undefined => items.get(id);
  }, [items]);

  return {
    items,
    activeItems,
    todayItems,
    getListItems,
    getItem,
    createItem,
    toggleItem,
    updateItem,
    deleteItem,
  };
}
