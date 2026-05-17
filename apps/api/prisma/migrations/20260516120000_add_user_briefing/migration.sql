-- Current daily-briefing state per user. One row per user, updated in
-- place by the two-stage pipeline (Haiku detector -> Sonnet writer or
-- template). Triggers (morning cron, calendar webhooks, overdue scanner,
-- newsletter ingest) set dirtyAt; the next client refresh call
-- materializes a new brief if dirty + outside 30min floor + under 6/day
-- ceiling. See docs/superpowers/specs/2026-05-16-briefing-pipeline-v2-design.md.

CREATE TABLE "UserBriefing" (
  "userId"            TEXT NOT NULL PRIMARY KEY,
  "content"           TEXT NOT NULL,
  "isEmpty"           BOOLEAN NOT NULL DEFAULT false,
  "signalsUsedIds"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "generatedAt"       TIMESTAMP(3) NOT NULL,
  "dirtyAt"           TIMESTAMP(3),
  "regenCountToday"   INTEGER NOT NULL DEFAULT 0,
  "regenDayKey"       TEXT NOT NULL,
  "lastTriggerSource" TEXT,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserBriefing_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "UserBriefing_dirtyAt_idx" ON "UserBriefing"("dirtyAt");
