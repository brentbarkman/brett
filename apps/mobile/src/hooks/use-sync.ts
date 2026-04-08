// ────────────────────────────────────────────────────────────────────────────
// useSync — React hook for sync status + manual sync trigger
//
// Thin wrapper around the Zustand sync store. Provides health data for
// UI indicators (pending badge, error banner) and a manual sync trigger.
// ────────────────────────────────────────────────────────────────────────────

import { useCallback } from "react";
import { useSyncStore } from "../store/sync";
import { sync } from "../sync/sync-manager";

export function useSync() {
  const lastSuccessfulPullAt = useSyncStore((s) => s.lastSuccessfulPullAt);
  const pendingMutationCount = useSyncStore((s) => s.pendingMutationCount);
  const deadMutationCount = useSyncStore((s) => s.deadMutationCount);
  const lastError = useSyncStore((s) => s.lastError);
  const consecutiveFailures = useSyncStore((s) => s.consecutiveFailures);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const refresh = useSyncStore((s) => s.refresh);
  const setIsSyncing = useSyncStore((s) => s.setIsSyncing);

  /** Trigger a full sync cycle and refresh store health afterwards. */
  const triggerSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      await sync();
    } finally {
      setIsSyncing(false);
      refresh();
    }
  }, [setIsSyncing, refresh]);

  /** Whether there are unresolved sync problems the user should know about. */
  const hasProblems = deadMutationCount > 0 || consecutiveFailures >= 3;

  return {
    lastSuccessfulPullAt,
    pendingMutationCount,
    deadMutationCount,
    lastError,
    consecutiveFailures,
    isSyncing,
    hasProblems,
    triggerSync,
    refresh,
  };
}
