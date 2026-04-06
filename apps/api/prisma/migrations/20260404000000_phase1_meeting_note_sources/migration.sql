-- DropIndex
DROP INDEX "embedding_vector_idx";

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "conferenceId" TEXT;

-- AlterTable
ALTER TABLE "GoogleAccount" ADD COLUMN     "hasDriveScope" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GranolaAccount" ADD COLUMN     "autoCreateFollowUps" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autoCreateMyTasks" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "GranolaMeeting" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'granola',
ADD COLUMN     "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "granolaDocumentId" DROP NOT NULL,
ALTER COLUMN "granolaAccountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Scout" ADD COLUMN     "analysisTier" TEXT NOT NULL DEFAULT 'standard';

-- CreateTable
CREATE TABLE "MeetingNoteSource" (
    "id" TEXT NOT NULL,
    "meetingNoteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "granolaAccountId" TEXT,
    "googleAccountId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "transcript" JSONB,
    "attendees" JSONB,
    "rawData" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingNoteSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingNoteSource_meetingNoteId_idx" ON "MeetingNoteSource"("meetingNoteId");

-- CreateIndex
CREATE INDEX "MeetingNoteSource_userId_provider_idx" ON "MeetingNoteSource"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingNoteSource_provider_externalId_key" ON "MeetingNoteSource"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "GranolaMeeting_userId_calendarEventId_key" ON "GranolaMeeting"("userId", "calendarEventId");

-- AddForeignKey
ALTER TABLE "MeetingNoteSource" ADD CONSTRAINT "MeetingNoteSource_meetingNoteId_fkey" FOREIGN KEY ("meetingNoteId") REFERENCES "GranolaMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingNoteSource" ADD CONSTRAINT "MeetingNoteSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingNoteSource" ADD CONSTRAINT "MeetingNoteSource_granolaAccountId_fkey" FOREIGN KEY ("granolaAccountId") REFERENCES "GranolaAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingNoteSource" ADD CONSTRAINT "MeetingNoteSource_googleAccountId_fkey" FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: Create MeetingNoteSource rows from existing Granola meetings
INSERT INTO "MeetingNoteSource" (id, "meetingNoteId", "userId", provider, "externalId", "granolaAccountId", title, summary, transcript, attendees, "rawData", "syncedAt", "createdAt")
SELECT gen_random_uuid(), id, "userId", 'granola', "granolaDocumentId", "granolaAccountId", title, summary, transcript, attendees, "rawData", "syncedAt", "createdAt"
FROM "GranolaMeeting"
WHERE "granolaDocumentId" IS NOT NULL;

-- Backfill: Mark existing meetings as having granola source
UPDATE "GranolaMeeting" SET sources = ARRAY['granola'];
