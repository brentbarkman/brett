-- DropForeignKey
ALTER TABLE "GranolaMeeting" DROP CONSTRAINT "GranolaMeeting_granolaAccountId_fkey";

-- DropIndex
DROP INDEX "embedding_vector_idx";

-- AlterTable
ALTER TABLE "GoogleAccount" ADD COLUMN     "meetingNotesEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "GranolaMeeting" ADD CONSTRAINT "GranolaMeeting_granolaAccountId_fkey" FOREIGN KEY ("granolaAccountId") REFERENCES "GranolaAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
