-- AlterTable
ALTER TABLE "User" ADD COLUMN "newsletterIngestToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_newsletterIngestToken_key" ON "User"("newsletterIngestToken");
