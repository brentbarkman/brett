-- Leader-election lease table for cron jobs. Used by lib/cron-lock.ts so
-- that running multiple API replicas no longer means multiple workers all
-- think they're the cron leader and duplicate webhook-renewal / calendar-
-- sync / scout-tick runs.

CREATE TABLE "CronLock" (
  "jobName"    TEXT NOT NULL PRIMARY KEY,
  "holder"     TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "updatedAt"  TIMESTAMP(3) NOT NULL
);

CREATE INDEX "CronLock_expiresAt_idx" ON "CronLock"("expiresAt");
