// ────────────────────────────────────────────────────────────────────────────
// Sync Manager — orchestrates push-then-pull cycles
//
// Entry point for the sync engine. Initializes on app start, resets
// in-flight mutations from previous crashes, monitors network state,
// and coordinates push -> pull sequences with simple locks.
// ────────────────────────────────────────────────────────────────────────────

import { push } from "./push-engine";
import { pull } from "./pull-engine";
import { resetInFlight, getPendingCount, getDeadCount } from "./mutation-queue";
import {
  startNetworkMonitor,
  onNetworkChange,
  isOnline,
} from "./network-monitor";
import { getSQLite } from "../db";
import { AuthExpiredError } from "../api/client";

let _pushLock = false;
let _pullLock = false;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _initialized = false;

// ── Init ────────────────────────────────────────────────────────────────────

/**
 * Initialize the sync engine. Call once at app startup.
 *
 * - Resets any in-flight mutations from a previous crash
 * - Starts network monitoring
 * - Subscribes to network restore events to trigger sync
 */
export function initSync(): void {
  if (_initialized) return;
  _initialized = true;

  // Reset any in-flight mutations from a previous crash
  resetInFlight();

  // Start network monitor
  startNetworkMonitor();

  // Sync on network restore
  onNetworkChange((online) => {
    if (online) sync();
  });
}

// ── Sync Cycle ──────────────────────────────────────────────────────────────

/**
 * Run a full sync cycle: push first, then pull.
 *
 * - Skipped if offline
 * - Push and pull each use a simple lock to prevent overlapping calls
 * - On success: updates _sync_health with timestamps, clears errors
 * - On failure: updates _sync_health with error, increments consecutive failures
 * - AuthExpiredError is re-thrown for the caller (auth flow) to handle
 */
export async function sync(): Promise<void> {
  if (!isOnline()) return;

  try {
    await pushIfNeeded();
    await pullChanges();
    updateSyncHealth(null);
  } catch (err) {
    if (err instanceof AuthExpiredError) throw err;
    updateSyncHealth(
      err instanceof Error ? err.message : "Unknown sync error",
    );
  }
}

async function pushIfNeeded(): Promise<void> {
  if (_pushLock) return;
  _pushLock = true;
  try {
    await push();
  } finally {
    _pushLock = false;
  }
}

async function pullChanges(): Promise<void> {
  if (_pullLock) return;
  _pullLock = true;
  try {
    await pull();
  } finally {
    _pullLock = false;
  }
}

// ── Debounced Push ──────────────────────────────────────────────────────────

/**
 * Schedule a sync cycle after a short debounce.
 * Called after every local mutation to coalesce rapid writes.
 */
export function schedulePushDebounced(): void {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    sync();
  }, 1000);
}

// ── Public Accessor ─────────────────────────────────────────────────────────

/** Convenience accessor for use in React components / hooks. */
export function getSyncManager() {
  return {
    sync,
    initSync,
    schedulePushDebounced,
    isOnline,
    getPendingCount,
    getDeadCount,
  };
}

// ── Sync Health ─────────────────────────────────────────────────────────────

/**
 * Update the _sync_health singleton row.
 *
 * - On success (error = null): records timestamps, clears error, resets failures
 * - On failure (error = string): records error, increments consecutive failures
 * - Always updates pending/dead mutation counts
 */
function updateSyncHealth(error: string | null): void {
  const sqlite = getSQLite();
  const now = new Date().toISOString();
  const pending = getPendingCount();
  const dead = getDeadCount();

  if (error) {
    sqlite.runSync(
      `UPDATE "_sync_health"
       SET "last_error" = ?,
           "pending_mutation_count" = ?,
           "dead_mutation_count" = ?,
           "consecutive_failures" = "consecutive_failures" + 1
       WHERE "id" = 'singleton'`,
      [error, pending, dead],
    );
  } else {
    sqlite.runSync(
      `UPDATE "_sync_health"
       SET "last_successful_push_at" = ?,
           "last_successful_pull_at" = ?,
           "last_error" = NULL,
           "pending_mutation_count" = ?,
           "dead_mutation_count" = ?,
           "consecutive_failures" = 0
       WHERE "id" = 'singleton'`,
      [now, now, pending, dead],
    );
  }
}
