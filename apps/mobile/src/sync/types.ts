// ────────────────────────────────────────────────────────────────────────────
// Local sync types — aligned with _mutation_queue / _sync_health SQLite schema
// ────────────────────────────────────────────────────────────────────────────

export type MutationStatus = "pending" | "in_flight" | "failed" | "dead" | "blocked";
export type MutationAction = "CREATE" | "UPDATE" | "DELETE";

/**
 * In-memory representation of a row in `_mutation_queue`.
 * `id` is the autoincrement integer PK assigned by SQLite.
 */
export interface MutationRecord {
  id: number;
  entityType: string;
  entityId: string;
  action: MutationAction;
  endpoint: string | null;
  method: string | null;
  payload: Record<string, unknown>;
  changedFields?: string[];
  previousValues?: Record<string, unknown>;
  baseUpdatedAt?: string;
  beforeSnapshot?: Record<string, unknown>;
  dependsOn?: number;
  batchId?: string;
  status: MutationStatus;
  retryCount: number;
  error?: string;
  errorCode?: string;
  createdAt: string;
}

export interface SyncHealthData {
  lastSuccessfulPushAt: string | null;
  lastSuccessfulPullAt: string | null;
  pendingMutationCount: number;
  deadMutationCount: number;
  lastError: string | null;
  consecutiveFailures: number;
}
