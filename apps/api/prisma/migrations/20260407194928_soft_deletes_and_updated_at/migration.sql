-- AlterTable: Add deletedAt (nullable) to soft-delete models
ALTER TABLE "Attachment" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "BrettMessage" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CalendarEvent" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "CalendarEventNote" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "List" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Scout" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "ScoutFinding" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable: Add updatedAt (NOT NULL) to models that were missing it.
-- Use DEFAULT NOW() so existing rows get a value, then drop the default
-- (Prisma's @updatedAt sets the value in the client, not via DB default).
ALTER TABLE "Attachment" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
ALTER TABLE "Attachment" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "BrettMessage" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
ALTER TABLE "BrettMessage" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "ScoutFinding" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
ALTER TABLE "ScoutFinding" ALTER COLUMN "updatedAt" DROP DEFAULT;
