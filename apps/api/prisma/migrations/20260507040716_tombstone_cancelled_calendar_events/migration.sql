-- One-time cleanup matching the calendar-visibility cascade in spirit.
--
-- Background: when Google cancels an event, calendar-sync's cancellation
-- handler set `status = "cancelled"` but did NOT set `deletedAt`. The
-- /calendar/events REST endpoint excluded those rows via `status: { not:
-- "cancelled" }`, but /sync/pull had no such filter — so iOS replicated
-- cancelled events as live rows and rendered them on the timeline,
-- diverging from desktop.
--
-- The code change tombstones cancelled events going forward. This
-- migration applies the same cascade once for events that were ALREADY
-- cancelled at deploy time — without it, iOS keeps showing them
-- forever (no tombstone signal will ever reach the client).
--
-- Idempotent: only flips `deletedAt` on rows that have status="cancelled"
-- AND aren't already tombstoned. Re-running is a no-op.
--
-- Reversible: if Google ever reinstates a cancelled event (the upsert
-- path now clears `deletedAt` on update), the row comes back to life
-- automatically.

UPDATE "CalendarEvent"
SET "deletedAt" = NOW(), "updatedAt" = NOW()
WHERE "status" = 'cancelled'
AND "deletedAt" IS NULL;
