-- CreateEnum
CREATE TYPE "ScoutMemoryType" AS ENUM ('factual', 'judgment', 'pattern');

-- CreateEnum
CREATE TYPE "ScoutMemoryStatus" AS ENUM ('active', 'superseded', 'removed', 'user_deleted');

-- CreateEnum
CREATE TYPE "ScoutConsolidationStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- AlterTable: Scout — add consolidation fields
ALTER TABLE "Scout" ADD COLUMN "consolidationRunCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Scout" ADD COLUMN "consolidationThreshold" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Scout" ADD COLUMN "lastConsolidatedAt" TIMESTAMP(3);

-- AlterTable: ScoutRun — add granular token tracking
ALTER TABLE "ScoutRun" ADD COLUMN "tokensInput" INTEGER;
ALTER TABLE "ScoutRun" ADD COLUMN "tokensOutput" INTEGER;
ALTER TABLE "ScoutRun" ADD COLUMN "modelId" TEXT;

-- AlterTable: ScoutFinding — replace dismissed with feedback
ALTER TABLE "ScoutFinding" DROP COLUMN "dismissed";
ALTER TABLE "ScoutFinding" ADD COLUMN "feedbackUseful" BOOLEAN;
ALTER TABLE "ScoutFinding" ADD COLUMN "feedbackAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ScoutMemory" (
    "id" TEXT NOT NULL,
    "scoutId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" "ScoutMemoryType" NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sourceRunIds" JSONB NOT NULL DEFAULT '[]',
    "status" "ScoutMemoryStatus" NOT NULL DEFAULT 'active',
    "supersededBy" TEXT,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "ScoutMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoutConsolidation" (
    "id" TEXT NOT NULL,
    "scoutId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runsSinceLastConsolidation" INTEGER NOT NULL,
    "memoriesBefore" INTEGER NOT NULL,
    "memoriesAfter" INTEGER NOT NULL,
    "memoriesCreated" INTEGER NOT NULL,
    "memoriesSuperseded" INTEGER NOT NULL,
    "tokensUsed" INTEGER NOT NULL,
    "tokensInput" INTEGER,
    "tokensOutput" INTEGER,
    "modelId" TEXT,
    "isBatch" BOOLEAN NOT NULL DEFAULT false,
    "batchRequestId" TEXT,
    "status" "ScoutConsolidationStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "ScoutConsolidation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScoutMemory_scoutId_status_idx" ON "ScoutMemory"("scoutId", "status");

-- CreateIndex
CREATE INDEX "ScoutConsolidation_scoutId_createdAt_idx" ON "ScoutConsolidation"("scoutId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoutConsolidation_status_idx" ON "ScoutConsolidation"("status");

-- AddForeignKey
ALTER TABLE "ScoutMemory" ADD CONSTRAINT "ScoutMemory_scoutId_fkey" FOREIGN KEY ("scoutId") REFERENCES "Scout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutConsolidation" ADD CONSTRAINT "ScoutConsolidation_scoutId_fkey" FOREIGN KEY ("scoutId") REFERENCES "Scout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
