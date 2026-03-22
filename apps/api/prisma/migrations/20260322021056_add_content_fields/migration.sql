-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "contentBody" TEXT,
ADD COLUMN     "contentDescription" TEXT,
ADD COLUMN     "contentDomain" TEXT,
ADD COLUMN     "contentFavicon" TEXT,
ADD COLUMN     "contentImageUrl" TEXT,
ADD COLUMN     "contentMetadata" JSONB,
ADD COLUMN     "contentStatus" TEXT,
ADD COLUMN     "contentTitle" TEXT,
ADD COLUMN     "contentType" TEXT;

-- CreateIndex
CREATE INDEX "Item_userId_contentType_idx" ON "Item"("userId", "contentType");

-- Migrate legacy type values to new "content" type
UPDATE "Item" SET type = 'content', "contentType" = 'web_page', "contentStatus" = 'pending' WHERE type = 'saved_web';
UPDATE "Item" SET type = 'content', "contentType" = 'tweet', "contentStatus" = 'pending' WHERE type = 'saved_tweet';
