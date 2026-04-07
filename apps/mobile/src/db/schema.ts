import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ────────────────────────────────────────────────────────────────────────────
// Helper: sync metadata columns shared by all data tables
// ────────────────────────────────────────────────────────────────────────────

// _syncStatus: "synced" | "pending" | "failed"
// _baseUpdatedAt: ISO-8601 server updatedAt at time of last pull (used for conflict detection)
// _lastError: last push error message (null when synced)

// ────────────────────────────────────────────────────────────────────────────
// Data Tables
// ────────────────────────────────────────────────────────────────────────────

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // "task" | "content"
  status: text("status").notNull().default("active"), // "active" | "snoozed" | "done" | "archived"
  title: text("title").notNull(),
  description: text("description"),
  notes: text("notes"),
  source: text("source").notNull().default("Brett"),
  sourceId: text("source_id"),
  sourceUrl: text("source_url"),
  dueDate: text("due_date"), // ISO-8601
  dueDatePrecision: text("due_date_precision"), // "day" | "week"
  completedAt: text("completed_at"), // ISO-8601
  snoozedUntil: text("snoozed_until"), // ISO-8601
  brettObservation: text("brett_observation"),
  reminder: text("reminder"), // "morning_of" | "1_hour_before" | "day_before" | "custom"
  recurrence: text("recurrence"), // "daily" | "weekly" | "monthly" | "custom"
  recurrenceRule: text("recurrence_rule"), // iCal RRULE
  brettTakeGeneratedAt: text("brett_take_generated_at"), // ISO-8601
  contentType: text("content_type"), // "tweet" | "article" | "video" | "pdf" | "podcast" | "web_page"
  contentStatus: text("content_status"), // "pending" | "extracted" | "failed"
  contentTitle: text("content_title"),
  contentBody: text("content_body"),
  contentDescription: text("content_description"),
  contentImageUrl: text("content_image_url"),
  contentFavicon: text("content_favicon"),
  contentDomain: text("content_domain"),
  listId: text("list_id"),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  // Sync metadata
  _syncStatus: text("_sync_status").notNull().default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
  _lastError: text("_last_error"),
  _provisionalParentId: text("_provisional_parent_id"),
});

export const lists = sqliteTable("lists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  colorClass: text("color_class").notNull().default("bg-gray-500"),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: text("archived_at"),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  // Sync metadata
  _syncStatus: text("_sync_status").notNull().default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
  _lastError: text("_last_error"),
});

export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(),
  googleEventId: text("google_event_id").notNull(),
  calendarId: text("calendar_id"),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  startTime: text("start_time").notNull(), // ISO-8601
  endTime: text("end_time").notNull(), // ISO-8601
  isAllDay: integer("is_all_day", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("confirmed"),
  myResponseStatus: text("my_response_status").notNull().default("needsAction"),
  meetingLink: text("meeting_link"),
  organizer: text("organizer"), // JSON string
  attendees: text("attendees"), // JSON string
  brettObservation: text("brett_observation"),
  calendarColor: text("calendar_color"),
  googleAccountId: text("google_account_id"),
  calendarListId: text("calendar_list_id"),
  recurrence: text("recurrence"),
  recurringEventId: text("recurring_event_id"),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  // Sync metadata
  _syncStatus: text("_sync_status").notNull().default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
});

export const calendarEventNotes = sqliteTable("calendar_event_notes", {
  id: text("id").primaryKey(),
  calendarEventId: text("calendar_event_id").notNull(),
  userId: text("user_id").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  // Sync metadata
  _syncStatus: text("_sync_status").notNull().default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
});

export const scouts = sqliteTable("scouts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  goal: text("goal").notNull(),
  context: text("context"),
  sources: text("sources").notNull(), // JSON string
  sensitivity: text("sensitivity").notNull().default("medium"),
  analysisTier: text("analysis_tier").notNull().default("standard"),
  cadenceIntervalHours: real("cadence_interval_hours").notNull(),
  budgetUsed: integer("budget_used").notNull().default(0),
  budgetTotal: integer("budget_total").notNull(),
  status: text("status").notNull().default("active"),
  statusLine: text("status_line"),
  nextRunAt: text("next_run_at"), // ISO-8601
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  // Sync metadata
  _syncStatus: text("_sync_status").notNull().default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
});

export const scoutFindings = sqliteTable("scout_findings", {
  id: text("id").primaryKey(),
  scoutId: text("scout_id").notNull(),
  type: text("type").notNull(), // "insight" | "article" | "task"
  title: text("title").notNull(),
  description: text("description").notNull(),
  sourceUrl: text("source_url"),
  sourceName: text("source_name").notNull(),
  relevanceScore: real("relevance_score").notNull(),
  reasoning: text("reasoning").notNull(),
  feedbackUseful: integer("feedback_useful", { mode: "boolean" }),
  itemId: text("item_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  // Sync metadata
  _syncStatus: text("_sync_status").notNull().default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
});

export const brettMessages = sqliteTable("brett_messages", {
  id: text("id").primaryKey(),
  itemId: text("item_id"),
  calendarEventId: text("calendar_event_id"),
  role: text("role").notNull(), // "user" | "brett"
  content: text("content").notNull(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  // Sync metadata
  _syncStatus: text("_sync_status").notNull().default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
});

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  url: text("url"),
  itemId: text("item_id").notNull(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
  // Sync metadata
  _syncStatus: text("_sync_status").notNull().default("synced"),
  _baseUpdatedAt: text("_base_updated_at"),
});

export const userProfile = sqliteTable("user_profile", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  assistantName: text("assistant_name").default("Brett"),
  timezone: text("timezone").default("America/Los_Angeles"),
  city: text("city"),
  countryCode: text("country_code"),
  tempUnit: text("temp_unit").default("auto"),
  weatherEnabled: integer("weather_enabled", { mode: "boolean" }).default(true),
  backgroundStyle: text("background_style").default("photography"),
  updatedAt: text("updated_at").notNull(),
});

// ────────────────────────────────────────────────────────────────────────────
// Sync Infrastructure Tables
// ────────────────────────────────────────────────────────────────────────────

export const mutationQueue = sqliteTable("_mutation_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(), // "CREATE" | "UPDATE" | "DELETE"
  endpoint: text("endpoint"),
  method: text("method"),
  payload: text("payload").notNull(), // JSON string
  changedFields: text("changed_fields"), // JSON string (string[])
  previousValues: text("previous_values"), // JSON string
  baseUpdatedAt: text("base_updated_at"),
  beforeSnapshot: text("before_snapshot"), // JSON string — full row before mutation
  dependsOn: integer("depends_on"), // id of mutation this depends on
  batchId: text("batch_id"),
  status: text("status").notNull().default("pending"), // "pending" | "in_flight" | "done" | "failed" | "dead"
  retryCount: integer("retry_count").notNull().default(0),
  error: text("error"),
  errorCode: text("error_code"),
  createdAt: text("created_at").notNull(),
});

export const syncCursors = sqliteTable("_sync_cursors", {
  tableName: text("table_name").primaryKey(),
  lastSyncedAt: text("last_synced_at"),
  isInitialSyncComplete: integer("is_initial_sync_complete", { mode: "boolean" }).notNull().default(false),
});

export const conflictLog = sqliteTable("_conflict_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  mutationId: integer("mutation_id"),
  localValues: text("local_values").notNull(), // JSON string
  serverValues: text("server_values").notNull(), // JSON string
  conflictedFields: text("conflicted_fields").notNull(), // JSON string (string[])
  resolution: text("resolution"), // "server_wins" | "local_wins" | "merged" | null (unresolved)
  resolvedAt: text("resolved_at"),
});

export const syncHealth = sqliteTable("_sync_health", {
  id: text("id").primaryKey().default("singleton"),
  lastSuccessfulPushAt: text("last_successful_push_at"),
  lastSuccessfulPullAt: text("last_successful_pull_at"),
  pendingMutationCount: integer("pending_mutation_count").notNull().default(0),
  deadMutationCount: integer("dead_mutation_count").notNull().default(0),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
});
