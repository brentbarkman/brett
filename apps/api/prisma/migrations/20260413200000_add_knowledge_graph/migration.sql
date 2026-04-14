-- CreateTable
CREATE TABLE "KnowledgeEntity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "embedding" vector(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRelationship" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "sourceType" TEXT,
    "provenanceEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEntity_userId_type_name_key" ON "KnowledgeEntity"("userId", "type", "name");

-- CreateIndex
CREATE INDEX "KnowledgeEntity_userId_idx" ON "KnowledgeEntity"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeRelationship_userId_idx" ON "KnowledgeRelationship"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeRelationship_sourceId_idx" ON "KnowledgeRelationship"("sourceId");

-- CreateIndex
CREATE INDEX "KnowledgeRelationship_targetId_idx" ON "KnowledgeRelationship"("targetId");

-- CreateIndex
CREATE INDEX "KnowledgeRelationship_userId_validUntil_idx" ON "KnowledgeRelationship"("userId", "validUntil");

-- AddForeignKey
ALTER TABLE "KnowledgeEntity" ADD CONSTRAINT "KnowledgeEntity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRelationship" ADD CONSTRAINT "KnowledgeRelationship_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRelationship" ADD CONSTRAINT "KnowledgeRelationship_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRelationship" ADD CONSTRAINT "KnowledgeRelationship_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "KnowledgeEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HNSW index for entity embedding similarity search
CREATE INDEX IF NOT EXISTS knowledge_entity_vector_idx
ON "KnowledgeEntity" USING hnsw (embedding vector_cosine_ops);
