// ────────────────────────────────────────────────────────────────────────────
// Sync Status Store — exposes sync health for UI indicators
//
// Reads from the _sync_health singleton row in SQLite. The sync manager
// updates that row after every push/pull cycle; this store reads it on
// demand via refresh().
// ────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { getSQLite } from "../db";
import type { SyncHealthData } from "../sync/types";

interface SyncState extends SyncHealthData {
  isSyncing: boolean;

  // Read current health from SQLite
  refresh: () => void;
  // Set by sync manager during push/pull
  setIsSyncing: (v: boolean) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  lastSuccessfulPushAt: null,
  lastSuccessfulPullAt: null,
  pendingMutationCount: 0,
  deadMutationCount: 0,
  lastError: null,
  consecutiveFailures: 0,
  isSyncing: false,

  refresh: () => {
    const db = getSQLite();
    const row = db.getFirstSync<Record<string, unknown>>(
      `SELECT * FROM _sync_health WHERE id = 'singleton'`,
    );

    if (row) {
      set({
        lastSuccessfulPushAt: (row.last_successful_push_at as string) ?? null,
        lastSuccessfulPullAt: (row.last_successful_pull_at as string) ?? null,
        pendingMutationCount: (row.pending_mutation_count as number) ?? 0,
        deadMutationCount: (row.dead_mutation_count as number) ?? 0,
        lastError: (row.last_error as string) ?? null,
        consecutiveFailures: (row.consecutive_failures as number) ?? 0,
      });
    }
  },

  setIsSyncing: (v) => set({ isSyncing: v }),
}));
