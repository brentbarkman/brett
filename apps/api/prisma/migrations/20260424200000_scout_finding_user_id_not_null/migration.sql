-- Release B of ScoutFinding.userId denormalization. Release A (migration
-- 20260423120002_scout_finding_user_id) added the column nullable, indexed
-- it, and backfilled existing rows from Scout.userId. Release A shipped
-- with sync pull's OR fallback so old replicas mid-rolling-deploy could
-- keep inserting rows with userId=NULL.
--
-- By the time this migration runs:
--   1. Every replica is on the new Prisma client and every finding writer
--      sets userId (verified: scout-runner.ts lines 1034 and 1424 both
--      include `userId: scout.userId` on create).
--   2. Production ScoutFinding.userId is fully backfilled (verified: at
--      ship time there were 0 rows total in the table, so no legacy data).
--
-- Safety: if somehow a NULL slipped through between release A and B, this
-- ALTER will abort the deploy. That's the desired failure mode — better
-- to fail the migration than to silently mis-scope a row.

ALTER TABLE "ScoutFinding" ALTER COLUMN "userId" SET NOT NULL;
