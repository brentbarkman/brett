-- Migration: normalise dueDate to the canonical storage convention.
--
-- After this migration, every `Item.dueDate` is at UTC midnight of the user's
-- intended calendar date (`YYYY-MM-DDT00:00:00.000Z`), and every
-- `Item.dueDatePrecision` is `"day"` (or NULL when no dueDate). This is what
-- the rewritten desktop + iOS clients now expect and what `computeUrgency`
-- reads — running this lets us delete `normalizeDueDate` / the week-precision
-- branch as dead code.
--
-- Two changes:
--   1. Convert legacy week-precision Sunday-anchored items to day-precision
--      Friday-anchored. Old convention stored the next Sunday with
--      precision="week"; new convention stores the upcoming Friday with
--      precision="day". Subtract 2 days, flip the precision.
--   2. Snap any dueDate that isn't already at UTC midnight to UTC midnight
--      of its UTC calendar date. Catches legacy iOS local-midnight writes
--      (e.g. `06:00Z` for MDT) and a handful of server-side paths that
--      previously used `setHours()` on the JS side.
--
-- Both updates are idempotent — re-running this migration on
-- already-canonical data is a no-op (the WHERE clauses filter out
-- rows that already match the target shape).

-- Step 1: week-precision Sunday → day-precision Friday.
-- Filter on EXTRACT(DOW … AT TIME ZONE 'UTC') = 0 so we only touch rows
-- that are actually stored as Sunday in UTC. If somehow a week-precision
-- row was stored on a different day (manual edit, older logic), we leave
-- the dueDate alone but still flip the precision so the field invariant
-- holds going forward.
UPDATE "Item"
SET
    "dueDate" = "dueDate" - INTERVAL '2 days',
    "dueDatePrecision" = 'day'
WHERE
    "dueDatePrecision" = 'week'
    AND "dueDate" IS NOT NULL
    AND EXTRACT(DOW FROM "dueDate" AT TIME ZONE 'UTC') = 0;

UPDATE "Item"
SET "dueDatePrecision" = 'day'
WHERE
    "dueDatePrecision" = 'week'
    AND "dueDate" IS NOT NULL;

-- Step 2: snap every dueDate to UTC midnight.
-- date_trunc('day', tstz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' truncates
-- in UTC explicitly — using date_trunc directly on a timestamptz uses the
-- session timezone, which on a fresh Railway connection happens to be UTC
-- but isn't guaranteed.
UPDATE "Item"
SET "dueDate" = date_trunc('day', "dueDate" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
WHERE
    "dueDate" IS NOT NULL
    AND "dueDate" != date_trunc('day', "dueDate" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
