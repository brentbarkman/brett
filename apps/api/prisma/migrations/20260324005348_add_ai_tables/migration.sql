-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "UserAIConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAIConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "itemId" TEXT,
    "calendarEventId" TEXT,
    "modelTier" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolName" TEXT,
    "toolArgs" JSONB,
    "tokenCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sourceSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationEmbedding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "chunkText" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAIConfig_userId_idx" ON "UserAIConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAIConfig_userId_provider_key" ON "UserAIConfig"("userId", "provider");

-- CreateIndex
CREATE INDEX "ConversationSession_userId_createdAt_idx" ON "ConversationSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationSession_itemId_idx" ON "ConversationSession"("itemId");

-- CreateIndex
CREATE INDEX "ConversationSession_calendarEventId_idx" ON "ConversationSession"("calendarEventId");

-- CreateIndex
CREATE INDEX "ConversationMessage_sessionId_createdAt_idx" ON "ConversationMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "UserFact_userId_category_idx" ON "UserFact"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "UserFact_userId_key_key" ON "UserFact"("userId", "key");

-- CreateIndex
CREATE INDEX "ConversationEmbedding_userId_idx" ON "ConversationEmbedding"("userId");

-- AddForeignKey
ALTER TABLE "UserAIConfig" ADD CONSTRAINT "UserAIConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConversationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFact" ADD CONSTRAINT "UserFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationEmbedding" ADD CONSTRAINT "ConversationEmbedding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationEmbedding" ADD CONSTRAINT "ConversationEmbedding_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConversationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HNSW index for vector similarity search
CREATE INDEX IF NOT EXISTS conversation_embedding_vector_idx
ON "ConversationEmbedding" USING hnsw (embedding vector_cosine_ops);
