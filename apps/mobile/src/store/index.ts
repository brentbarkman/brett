// ────────────────────────────────────────────────────────────────────────────
// Store initialization — hydrate all stores from SQLite on app launch
//
// Call initializeStores() once after the database is initialized and the
// user is authenticated. Each store reads its data from SQLite into memory.
// ────────────────────────────────────────────────────────────────────────────

import { useItemsStore } from "./items";
import { useListsStore } from "./lists";
import { useSyncStore } from "./sync";

/**
 * Hydrate all Zustand stores from SQLite.
 * Must be called after getDatabase() has been invoked at least once
 * (so tables exist) and before rendering any data-dependent screens.
 */
export function initializeStores(): void {
  useItemsStore.getState().hydrate();
  useListsStore.getState().hydrate();
  useSyncStore.getState().refresh();
}

export { useItemsStore } from "./items";
export { useListsStore } from "./lists";
export { useSyncStore } from "./sync";
export type { ItemRow } from "./items";
export type { ListRow } from "./lists";
