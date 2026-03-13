-- Migrate existing inbox items to active
UPDATE "Item" SET status = 'active' WHERE status = 'inbox';

-- AlterTable
ALTER TABLE "Item" ALTER COLUMN "status" SET DEFAULT 'active';
