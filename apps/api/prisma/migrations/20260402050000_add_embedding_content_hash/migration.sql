-- Add contentHash column to Embedding table for change detection.
-- Stored on chunk 0 only; if the hash matches, the embedding pipeline
-- skips the Voyage API call entirely (saves ~40-60% of embedding costs).
ALTER TABLE "Embedding" ADD COLUMN "contentHash" TEXT;
