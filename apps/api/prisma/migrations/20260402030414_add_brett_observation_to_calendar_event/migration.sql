-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "brettObservation" TEXT,
ADD COLUMN     "brettObservationAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "GranolaAccount" ADD COLUMN     "autoCreateFollowUps" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autoCreateMyTasks" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "GranolaMeeting" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'granola';

-- AlterTable
ALTER TABLE "Scout" ADD COLUMN     "analysisTier" TEXT NOT NULL DEFAULT 'standard';
