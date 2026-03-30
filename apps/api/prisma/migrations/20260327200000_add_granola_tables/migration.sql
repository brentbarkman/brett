-- CreateTable
CREATE TABLE "GranolaAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GranolaAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GranolaMeeting" (
    "id" TEXT NOT NULL,
    "granolaDocumentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "granolaAccountId" TEXT NOT NULL,
    "calendarEventId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "transcript" JSONB,
    "actionItems" JSONB,
    "attendees" JSONB,
    "meetingStartedAt" TIMESTAMP(3) NOT NULL,
    "meetingEndedAt" TIMESTAMP(3) NOT NULL,
    "rawData" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GranolaMeeting_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "granolaMeetingId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "GranolaAccount_userId_key" ON "GranolaAccount"("userId");

-- CreateIndex
CREATE INDEX "GranolaAccount_userId_idx" ON "GranolaAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GranolaMeeting_granolaDocumentId_key" ON "GranolaMeeting"("granolaDocumentId");

-- CreateIndex
CREATE INDEX "GranolaMeeting_userId_meetingStartedAt_idx" ON "GranolaMeeting"("userId", "meetingStartedAt");

-- CreateIndex
CREATE INDEX "GranolaMeeting_granolaAccountId_idx" ON "GranolaMeeting"("granolaAccountId");

-- CreateIndex
CREATE INDEX "GranolaMeeting_calendarEventId_idx" ON "GranolaMeeting"("calendarEventId");

-- AddForeignKey
ALTER TABLE "GranolaAccount" ADD CONSTRAINT "GranolaAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GranolaMeeting" ADD CONSTRAINT "GranolaMeeting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GranolaMeeting" ADD CONSTRAINT "GranolaMeeting_granolaAccountId_fkey" FOREIGN KEY ("granolaAccountId") REFERENCES "GranolaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GranolaMeeting" ADD CONSTRAINT "GranolaMeeting_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_granolaMeetingId_fkey" FOREIGN KEY ("granolaMeetingId") REFERENCES "GranolaMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
