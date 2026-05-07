-- Re-tombstone events on currently-hidden calendars.
--
-- The cascade migration shipped earlier today (20260506222541) tombstoned
-- existing events on isVisible: false calendars at deploy time. But the
-- reconciliation cron (every 4h) calls `incrementalSync(accountId)`,
-- which (until the code change in this same PR) iterated ALL calendars
-- on the account regardless of visibility. For each calendar it called
-- `upsertEvents`, whose UPDATE branch clears `deletedAt: null` (added
-- in PR #139 to support the visibility-on cascade restoring events).
-- The net effect: every 4 hours, the cron silently un-tombstoned the
-- events on hidden calendars, re-leaking them to iOS via /sync/pull.
--
-- The code change in this PR plugs the leak — `incrementalSync` now
-- filters `isVisible: true`. This migration cleans up the rows the
-- pre-fix cron already un-tombstoned, so iOS gets the tombstone signal
-- on its next pull and finally purges them locally.
--
-- Idempotent + reversible (toggling a hidden calendar back on still
-- works: PATCH clears the syncToken and the next periodic
-- incrementalSync — now correctly scoped — full-fetches and the upsert
-- path clears deletedAt for the events Google still has).

UPDATE "CalendarEvent"
SET "deletedAt" = NOW(), "updatedAt" = NOW()
WHERE "calendarListId" IN (
  SELECT id FROM "CalendarList" WHERE "isVisible" = false
)
AND "deletedAt" IS NULL;
