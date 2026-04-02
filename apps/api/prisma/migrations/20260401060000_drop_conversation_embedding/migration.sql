-- Drop old ConversationEmbedding table (data will be re-embedded via backfill at 1024 dims)
DROP INDEX IF EXISTS conversation_embedding_vector_idx;
DROP TABLE IF EXISTS "ConversationEmbedding";
