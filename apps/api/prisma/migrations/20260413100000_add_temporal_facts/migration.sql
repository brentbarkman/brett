-- Add new columns to UserFact for temporal tracking
ALTER TABLE "UserFact" ADD COLUMN IF NOT EXISTS "sourceType" TEXT;
ALTER TABLE "UserFact" ADD COLUMN IF NOT EXISTS "sourceEntityId" TEXT;
ALTER TABLE "UserFact" ADD COLUMN IF NOT EXISTS "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "UserFact" ADD COLUMN IF NOT EXISTS "validUntil" TIMESTAMP(3);
ALTER TABLE "UserFact" ADD COLUMN IF NOT EXISTS "supersededBy" TEXT;

-- Drop old unique constraint (userId, key), replace with partial unique index
-- Only one active (validUntil IS NULL) fact per user+key
ALTER TABLE "UserFact" DROP CONSTRAINT IF EXISTS "UserFact_userId_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "UserFact_userId_key_active_unique" ON "UserFact"("userId", "key")
  WHERE "validUntil" IS NULL;

-- Index for efficient current-fact lookups
CREATE INDEX IF NOT EXISTS "UserFact_userId_validUntil_idx" ON "UserFact"("userId", "validUntil");
