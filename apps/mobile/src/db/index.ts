import * as SQLite from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";
import * as schema from "./schema";

// ────────────────────────────────────────────────────────────────────────────
// Database singleton
// ────────────────────────────────────────────────────────────────────────────

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: SQLite.SQLiteDatabase | null = null;

export function getDatabase() {
  if (!_db) {
    _sqlite = SQLite.openDatabaseSync("brett.db");

    // WAL mode for concurrent reads during sync
    _sqlite.execSync("PRAGMA journal_mode=WAL;");
    // Timeout when the DB is locked by another connection
    _sqlite.execSync("PRAGMA busy_timeout=5000;");
    // FK enforcement off — sync can arrive in any order, we reconcile later
    _sqlite.execSync("PRAGMA foreign_keys=OFF;");

    createTablesIfNeeded(_sqlite);

    _db = drizzle(_sqlite, { schema });
  }
  return _db;
}

export function getSQLite() {
  if (!_sqlite) getDatabase();
  return _sqlite!;
}

export type Database = ReturnType<typeof getDatabase>;

export { schema };

// ────────────────────────────────────────────────────────────────────────────
// Table creation — runs on every app launch (IF NOT EXISTS is idempotent)
// ────────────────────────────────────────────────────────────────────────────

function createTablesIfNeeded(db: SQLite.SQLiteDatabase) {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS "items" (
      "id" text PRIMARY KEY NOT NULL,
      "type" text NOT NULL,
      "status" text NOT NULL DEFAULT 'active',
      "title" text NOT NULL,
      "description" text,
      "notes" text,
      "source" text NOT NULL DEFAULT 'Brett',
      "source_id" text,
      "source_url" text,
      "due_date" text,
      "due_date_precision" text,
      "completed_at" text,
      "snoozed_until" text,
      "brett_observation" text,
      "reminder" text,
      "recurrence" text,
      "recurrence_rule" text,
      "brett_take_generated_at" text,
      "content_type" text,
      "content_status" text,
      "content_title" text,
      "content_body" text,
      "content_description" text,
      "content_image_url" text,
      "content_favicon" text,
      "content_domain" text,
      "content_metadata" text,
      "meeting_note_id" text,
      "list_id" text,
      "user_id" text NOT NULL,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL,
      "deleted_at" text,
      "_sync_status" text NOT NULL DEFAULT 'synced',
      "_base_updated_at" text,
      "_last_error" text,
      "_provisional_parent_id" text
    );

    CREATE TABLE IF NOT EXISTS "lists" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "color_class" text NOT NULL DEFAULT 'bg-gray-500',
      "sort_order" integer NOT NULL DEFAULT 0,
      "archived_at" text,
      "user_id" text NOT NULL,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL,
      "deleted_at" text,
      "_sync_status" text NOT NULL DEFAULT 'synced',
      "_base_updated_at" text,
      "_last_error" text
    );

    CREATE TABLE IF NOT EXISTS "calendar_events" (
      "id" text PRIMARY KEY NOT NULL,
      "google_event_id" text NOT NULL,
      "calendar_id" text,
      "title" text NOT NULL,
      "description" text,
      "location" text,
      "start_time" text NOT NULL,
      "end_time" text NOT NULL,
      "is_all_day" integer NOT NULL DEFAULT 0,
      "status" text NOT NULL DEFAULT 'confirmed',
      "my_response_status" text NOT NULL DEFAULT 'needsAction',
      "meeting_link" text,
      "organizer" text,
      "attendees" text,
      "brett_observation" text,
      "calendar_color" text,
      "google_account_id" text,
      "calendar_list_id" text,
      "recurrence" text,
      "recurring_event_id" text,
      "user_id" text NOT NULL,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL,
      "deleted_at" text,
      "_sync_status" text NOT NULL DEFAULT 'synced',
      "_base_updated_at" text
    );

    CREATE TABLE IF NOT EXISTS "calendar_event_notes" (
      "id" text PRIMARY KEY NOT NULL,
      "calendar_event_id" text NOT NULL,
      "user_id" text NOT NULL,
      "content" text NOT NULL,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL,
      "deleted_at" text,
      "_sync_status" text NOT NULL DEFAULT 'synced',
      "_base_updated_at" text
    );

    CREATE TABLE IF NOT EXISTS "scouts" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "goal" text NOT NULL,
      "context" text,
      "sources" text NOT NULL,
      "sensitivity" text NOT NULL DEFAULT 'medium',
      "analysis_tier" text NOT NULL DEFAULT 'standard',
      "cadence_interval_hours" real NOT NULL,
      "budget_used" integer NOT NULL DEFAULT 0,
      "budget_total" integer NOT NULL,
      "status" text NOT NULL DEFAULT 'active',
      "status_line" text,
      "next_run_at" text,
      "user_id" text NOT NULL,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL,
      "deleted_at" text,
      "_sync_status" text NOT NULL DEFAULT 'synced',
      "_base_updated_at" text
    );

    CREATE TABLE IF NOT EXISTS "scout_findings" (
      "id" text PRIMARY KEY NOT NULL,
      "scout_id" text NOT NULL,
      "type" text NOT NULL,
      "title" text NOT NULL,
      "description" text NOT NULL,
      "source_url" text,
      "source_name" text NOT NULL,
      "relevance_score" real NOT NULL,
      "reasoning" text NOT NULL,
      "feedback_useful" integer,
      "item_id" text,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL,
      "deleted_at" text,
      "_sync_status" text NOT NULL DEFAULT 'synced',
      "_base_updated_at" text
    );

    CREATE TABLE IF NOT EXISTS "brett_messages" (
      "id" text PRIMARY KEY NOT NULL,
      "item_id" text,
      "calendar_event_id" text,
      "role" text NOT NULL,
      "content" text NOT NULL,
      "user_id" text NOT NULL,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL,
      "deleted_at" text,
      "_sync_status" text NOT NULL DEFAULT 'synced',
      "_base_updated_at" text
    );

    CREATE TABLE IF NOT EXISTS "attachments" (
      "id" text PRIMARY KEY NOT NULL,
      "filename" text NOT NULL,
      "mime_type" text NOT NULL,
      "size_bytes" integer NOT NULL,
      "storage_key" text NOT NULL,
      "url" text,
      "item_id" text NOT NULL,
      "user_id" text NOT NULL,
      "created_at" text NOT NULL,
      "updated_at" text NOT NULL,
      "deleted_at" text,
      "_sync_status" text NOT NULL DEFAULT 'synced',
      "_base_updated_at" text
    );

    CREATE TABLE IF NOT EXISTS "user_profile" (
      "id" text PRIMARY KEY NOT NULL,
      "email" text NOT NULL,
      "name" text NOT NULL,
      "avatar_url" text,
      "assistant_name" text DEFAULT 'Brett',
      "timezone" text DEFAULT 'America/Los_Angeles',
      "city" text,
      "country_code" text,
      "temp_unit" text DEFAULT 'auto',
      "weather_enabled" integer DEFAULT 1,
      "background_style" text DEFAULT 'photography',
      "updated_at" text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "_mutation_queue" (
      "id" integer PRIMARY KEY AUTOINCREMENT,
      "entity_type" text NOT NULL,
      "entity_id" text NOT NULL,
      "action" text NOT NULL,
      "endpoint" text,
      "method" text,
      "payload" text NOT NULL,
      "changed_fields" text,
      "previous_values" text,
      "base_updated_at" text,
      "before_snapshot" text,
      "depends_on" integer,
      "batch_id" text,
      "status" text NOT NULL DEFAULT 'pending',
      "retry_count" integer NOT NULL DEFAULT 0,
      "error" text,
      "error_code" text,
      "created_at" text NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "_sync_cursors" (
      "table_name" text PRIMARY KEY NOT NULL,
      "last_synced_at" text,
      "is_initial_sync_complete" integer NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS "_conflict_log" (
      "id" integer PRIMARY KEY AUTOINCREMENT,
      "entity_type" text NOT NULL,
      "entity_id" text NOT NULL,
      "mutation_id" integer,
      "local_values" text NOT NULL,
      "server_values" text NOT NULL,
      "conflicted_fields" text NOT NULL,
      "resolution" text,
      "resolved_at" text
    );

    CREATE TABLE IF NOT EXISTS "_sync_health" (
      "id" text PRIMARY KEY NOT NULL DEFAULT 'singleton',
      "last_successful_push_at" text,
      "last_successful_pull_at" text,
      "pending_mutation_count" integer NOT NULL DEFAULT 0,
      "dead_mutation_count" integer NOT NULL DEFAULT 0,
      "last_error" text,
      "consecutive_failures" integer NOT NULL DEFAULT 0
    );
  `);

  // Seed the singleton sync_health row
  db.execSync(`
    INSERT OR IGNORE INTO "_sync_health" ("id") VALUES ('singleton');
  `);
}

// ────────────────────────────────────────────────────────────────────────────
// wipeDatabase — clears all data (used on sign-out)
// ────────────────────────────────────────────────────────────────────────────

const ALL_TABLES = [
  "items",
  "lists",
  "calendar_events",
  "calendar_event_notes",
  "scouts",
  "scout_findings",
  "brett_messages",
  "attachments",
  "user_profile",
  "_mutation_queue",
  "_sync_cursors",
  "_sync_health",
  "_conflict_log",
] as const;

export function wipeDatabase() {
  const db = getSQLite();
  for (const table of ALL_TABLES) {
    db.execSync(`DELETE FROM "${table}";`);
  }
  // Re-seed the singleton health row after wipe
  db.execSync(`INSERT OR IGNORE INTO "_sync_health" ("id") VALUES ('singleton');`);
}
