-- Release A of ScoutFinding.userId denormalization. Nullable for now so
-- the migration (which prisma wraps in a transaction) doesn't lock the
-- table on a backfill UPDATE — and so the old replica, still running
-- during the rolling deploy window without the updated Prisma client,
-- can keep inserting findings that simply leave userId as NULL.
--
-- Release B (follow-up): verify no nulls remain, then ALTER COLUMN SET
-- NOT NULL and drop the OR fallback in routes/sync.ts.

-- 1. Add the column.
ALTER TABLE "ScoutFinding" ADD COLUMN "userId" TEXT;

-- 2. Index for sync pull. B-tree allows nulls, so this works fine while
--    the column is still nullable. The old `(scoutId, createdAt)` index
--    stays around — it's still the right shape for findings-by-scout
--    queries elsewhere in the app.
CREATE INDEX "ScoutFinding_userId_updatedAt_idx"
  ON "ScoutFinding"("userId", "updatedAt");

-- 3. Backfill from scout.userId. Correlated subquery — fine for the row
--    count ScoutFinding currently has; if this table ever grows large
--    enough that the migration takes real time, swap this for a chunked
--    update run outside a transaction (see Release B notes).
UPDATE "ScoutFinding" sf
SET "userId" = s."userId"
FROM "Scout" s
WHERE s.id = sf."scoutId"
  AND sf."userId" IS NULL;
