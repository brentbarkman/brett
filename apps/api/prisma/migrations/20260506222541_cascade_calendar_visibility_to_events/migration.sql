-- One-time cleanup for the calendar-visibility cascade.
--
-- Background: until this release, /sync/pull (used by iOS) ignored the
-- CalendarList.isVisible flag — only /calendar/events (used by desktop)
-- respected it. iOS therefore replicated events from calendars the user
-- had hidden via the visibility toggle, and showed them on the timeline
-- where desktop did not.
--
-- The code change adds the visibility filter to /sync/pull. But that
-- filter alone only gates *future* upserts; rows already replicated to
-- iOS clients persist locally. Toggling a calendar from visible→hidden
-- now cascades a soft-delete (PATCH /calendar/accounts/.../calendars/...
-- in calendar-accounts.ts) so the next /sync/pull emits tombstones and
-- iOS evicts them. This migration applies the same cascade once for
-- calendars that were ALREADY hidden at deploy time — without it,
-- existing iOS users keep seeing leaked events forever.
--
-- Safety: only soft-deletes events whose parent CalendarList is
-- isVisible=false AND aren't already tombstoned. Idempotent — a re-run
-- is a no-op. Reversible via the toggle: re-showing a calendar clears
-- the syncToken and the next incrementalSync's upsertEvents path
-- restores deletedAt=null on rows Google still has.

UPDATE "CalendarEvent"
SET "deletedAt" = NOW(), "updatedAt" = NOW()
WHERE "calendarListId" IN (
  SELECT id FROM "CalendarList" WHERE "isVisible" = false
)
AND "deletedAt" IS NULL;
