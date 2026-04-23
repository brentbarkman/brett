-- Sync pull queries filter by (userId, updatedAt > cursor) for each table.
-- Without these composite indexes the query planner falls back to seq scans,
-- which gets bad fast for users with many rows. Indexes are cheap to add
-- (they're non-blocking when CONCURRENTLY — but Prisma wraps migrations in a
-- transaction so we can't use CONCURRENTLY here; these tables are small
-- enough in current prod that the non-concurrent add is acceptable).

-- List
CREATE INDEX "List_userId_updatedAt_idx" ON "List"("userId", "updatedAt");

-- Attachment (future sync pull + per-user listing)
CREATE INDEX "Attachment_userId_updatedAt_idx" ON "Attachment"("userId", "updatedAt");

-- CalendarEventNote
CREATE INDEX "CalendarEventNote_userId_updatedAt_idx" ON "CalendarEventNote"("userId", "updatedAt");

-- Scout (sync pull + tombstone pull)
CREATE INDEX "Scout_userId_updatedAt_idx" ON "Scout"("userId", "updatedAt");
