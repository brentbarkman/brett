// Pull Protocol
export interface SyncPullRequest {
  cursors: Record<string, string | null>;
  limit?: number;
  protocolVersion: number;
}

export interface SyncTableChanges<T = Record<string, unknown>> {
  upserted: T[];
  deleted: string[];
  hasMore: boolean;
}

export interface SyncPullResponse {
  changes: Record<string, SyncTableChanges>;
  cursors: Record<string, string>;
  serverTime: string;
  fullSyncRequired?: boolean;
}

// Push Protocol
export type SyncMutationAction = "CREATE" | "UPDATE" | "DELETE";

export interface SyncMutation {
  idempotencyKey: string;
  entityType: string;
  entityId: string;
  action: SyncMutationAction;
  payload: Record<string, unknown>;
  changedFields?: string[];
  previousValues?: Record<string, unknown>;
  baseUpdatedAt?: string;
}

export interface SyncPushRequest {
  mutations: SyncMutation[];
  protocolVersion: number;
}

export type SyncMutationResultStatus = "applied" | "merged" | "conflict" | "error" | "not_found";

export interface SyncMutationResult {
  idempotencyKey: string;
  status: SyncMutationResultStatus;
  record?: Record<string, unknown>;
  conflictedFields?: string[];
  error?: string;
}

export interface SyncPushResponse {
  results: SyncMutationResult[];
  serverTime: string;
}

// Sync Table Registry
export const SYNC_TABLES = [
  "lists", "items", "calendar_events", "calendar_event_notes",
  "scouts", "scout_findings", "brett_messages", "attachments",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

// Maps sync table names to camelCase Prisma model accessor names (e.g. prisma[modelAccessor])
export const SYNC_TABLE_TO_MODEL: Record<SyncTable, string> = {
  lists: "list",
  items: "item",
  calendar_events: "calendarEvent",
  calendar_event_notes: "calendarEventNote",
  scouts: "scout",
  scout_findings: "scoutFinding",
  brett_messages: "brettMessage",
  attachments: "attachment",
};

// Pushable Entity Types (security: server-side allowlist)
export const PUSHABLE_ENTITY_TYPES = ["item", "list", "calendar_event_note"] as const;
export type PushableEntityType = (typeof PUSHABLE_ENTITY_TYPES)[number];

// Mutable Fields Allowlist (security: per-entity-type)
export const MUTABLE_FIELDS: Record<PushableEntityType, readonly string[]> = {
  item: ["title", "description", "notes", "status", "dueDate", "dueDatePrecision",
         "completedAt", "snoozedUntil", "reminder", "recurrence", "recurrenceRule",
         "listId", "brettObservation", "contentType", "contentStatus"],
  list: ["name", "colorClass", "sortOrder", "archivedAt"],
  calendar_event_note: ["content"],
};

// Device Registration
export interface DeviceRegistration {
  token: string;
  platform: "ios" | "android";
  appVersion?: string;
}
