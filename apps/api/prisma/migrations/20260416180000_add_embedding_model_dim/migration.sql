-- Record the embedding model + dimension alongside each vector. Existing rows
-- get NULL, which is fine: the single production provider today is Voyage
-- (voyage-4-large, 1024d) and that's what the `vector(1024)` column statically
-- enforces. These columns let us safely introduce a second provider / bump
-- model versions later without silently mixing incompatible vectors.
ALTER TABLE "Embedding" ADD COLUMN "model" TEXT;
ALTER TABLE "Embedding" ADD COLUMN "dim" INTEGER;

-- Queryability: if we end up filtering by model during a dual-provider window,
-- (userId, model) is the selective index.
CREATE INDEX IF NOT EXISTS "Embedding_userId_model_idx" ON "Embedding" ("userId", "model");
