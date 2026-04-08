// ────────────────────────────────────────────────────────────────────────────
// useLists — React hook for list data + actions
//
// Thin wrapper around the Zustand lists store. Provides the sorted list
// array and CRUD actions with userId injection.
// ────────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { useListsStore } from "../store/lists";
import type { ListRow } from "../store/lists";
import { useItemsStore } from "../store/items";
import type { CreateListInput, UpdateListInput } from "@brett/types";
import { useAuth } from "../auth/provider";

/** List with item counts, matching the NavList shape used by the desktop. */
export interface NavListView {
  id: string;
  name: string;
  colorClass: string;
  sortOrder: number;
  count: number;         // active items in this list
  completedCount: number; // done items in this list
  archivedAt: string | null;
}

export function useLists() {
  const lists = useListsStore((s) => s.lists);
  const createListAction = useListsStore((s) => s.createList);
  const updateList = useListsStore((s) => s.updateList);
  const deleteList = useListsStore((s) => s.deleteList);
  const items = useItemsStore((s) => s.items);
  const { userId } = useAuth();

  /** Create a list, injecting the current userId. */
  const createList = useMemo(() => {
    return (input: CreateListInput): string | null => {
      if (!userId) return null;
      return createListAction(userId, input);
    };
  }, [userId, createListAction]);

  /** Lists enriched with item counts, matching NavList shape. */
  const navLists: NavListView[] = useMemo(() => {
    // Pre-compute counts by listId
    const countsByList = new Map<string, { active: number; done: number }>();
    for (const item of items.values()) {
      if (!item.listId) continue;
      const counts = countsByList.get(item.listId) ?? { active: 0, done: 0 };
      if (item.status === "done") {
        counts.done++;
      } else if (item.status === "active") {
        counts.active++;
      }
      countsByList.set(item.listId, counts);
    }

    return lists
      .filter((l) => !l.archivedAt)
      .map((l) => {
        const counts = countsByList.get(l.id) ?? { active: 0, done: 0 };
        return {
          id: l.id,
          name: l.name,
          colorClass: l.colorClass,
          sortOrder: l.sortOrder,
          count: counts.active,
          completedCount: counts.done,
          archivedAt: l.archivedAt,
        };
      });
  }, [lists, items]);

  /** Get a single list by ID. */
  const getList = useMemo(() => {
    return (id: string): ListRow | undefined => lists.find((l) => l.id === id);
  }, [lists]);

  return {
    lists,
    navLists,
    getList,
    createList,
    updateList,
    deleteList,
  };
}
