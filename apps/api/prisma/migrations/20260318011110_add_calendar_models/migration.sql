-- AlterTable
ALTER TABLE "BrettMessage" ADD COLUMN     "calendarEventId" TEXT,
ALTER COLUMN "itemId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "googleUserId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarList" (
    "id" TEXT NOT NULL,
    "googleAccountId" TEXT NOT NULL,
    "googleCalendarId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "watchChannelId" TEXT,
    "watchResourceId" TEXT,
    "watchToken" TEXT,
    "watchExpiration" TIMESTAMP(3),
    "syncToken" TEXT,

    CONSTRAINT "CalendarList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleAccountId" TEXT NOT NULL,
    "calendarListId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "myResponseStatus" TEXT NOT NULL DEFAULT 'needsAction',
    "recurrence" TEXT,
    "recurringEventId" TEXT,
    "meetingLink" TEXT,
    "googleColorId" TEXT,
    "organizer" JSONB,
    "attendees" JSONB,
    "attachments" JSONB,
    "rawGoogleEvent" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventNote" (
    "id" TEXT NOT NULL,
    "calendarEventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEventNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoogleAccount_userId_idx" ON "GoogleAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAccount_userId_googleUserId_key" ON "GoogleAccount"("userId", "googleUserId");

-- CreateIndex
CREATE INDEX "CalendarList_googleAccountId_idx" ON "CalendarList"("googleAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarList_googleAccountId_googleCalendarId_key" ON "CalendarList"("googleAccountId", "googleCalendarId");

-- CreateIndex
CREATE INDEX "CalendarEvent_userId_startTime_idx" ON "CalendarEvent"("userId", "startTime");

-- CreateIndex
CREATE INDEX "CalendarEvent_calendarListId_idx" ON "CalendarEvent"("calendarListId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_googleAccountId_googleEventId_key" ON "CalendarEvent"("googleAccountId", "googleEventId");

-- CreateIndex
CREATE INDEX "CalendarEventNote_userId_idx" ON "CalendarEventNote"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventNote_calendarEventId_userId_key" ON "CalendarEventNote"("calendarEventId", "userId");

-- CreateIndex
CREATE INDEX "BrettMessage_calendarEventId_createdAt_idx" ON "BrettMessage"("calendarEventId", "createdAt");

-- CreateIndex
CREATE INDEX "BrettMessage_userId_idx" ON "BrettMessage"("userId");

-- AddForeignKey
ALTER TABLE "BrettMessage" ADD CONSTRAINT "BrettMessage_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleAccount" ADD CONSTRAINT "GoogleAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarList" ADD CONSTRAINT "CalendarList_googleAccountId_fkey" FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_googleAccountId_fkey" FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_calendarListId_fkey" FOREIGN KEY ("calendarListId") REFERENCES "CalendarList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventNote" ADD CONSTRAINT "CalendarEventNote_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventNote" ADD CONSTRAINT "CalendarEventNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
