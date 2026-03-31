-- CreateEnum
CREATE TYPE "ScoutStatus" AS ENUM ('active', 'paused', 'completed', 'expired');

-- CreateEnum
CREATE TYPE "ScoutSensitivity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "ScoutRunStatus" AS ENUM ('running', 'success', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "FindingType" AS ENUM ('insight', 'article', 'task');

-- CreateEnum
CREATE TYPE "ScoutActivityType" AS ENUM ('created', 'paused', 'resumed', 'completed', 'expired', 'config_changed', 'cadence_adapted', 'budget_alert');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "sourceId" TEXT;

-- CreateIndex
CREATE INDEX "Item_userId_source_sourceId_idx" ON "Item"("userId", "source", "sourceId");

-- CreateTable
CREATE TABLE "Scout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "avatarLetter" TEXT NOT NULL,
    "avatarGradientFrom" TEXT NOT NULL,
    "avatarGradientTo" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "context" TEXT,
    "sources" JSONB NOT NULL,
    "sensitivity" "ScoutSensitivity" NOT NULL DEFAULT 'medium',
    "cadenceIntervalHours" DOUBLE PRECISION NOT NULL,
    "cadenceMinIntervalHours" DOUBLE PRECISION NOT NULL,
    "cadenceCurrentIntervalHours" DOUBLE PRECISION NOT NULL,
    "cadenceReason" TEXT,
    "budgetTotal" INTEGER NOT NULL,
    "budgetUsed" INTEGER NOT NULL DEFAULT 0,
    "budgetResetAt" TIMESTAMP(3) NOT NULL,
    "status" "ScoutStatus" NOT NULL DEFAULT 'active',
    "statusLine" TEXT,
    "endDate" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "conversationSessionId" TEXT,

    CONSTRAINT "Scout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoutRun" (
    "id" TEXT NOT NULL,
    "scoutId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ScoutRunStatus" NOT NULL,
    "searchQueries" JSONB NOT NULL DEFAULT '[]',
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "findingsCount" INTEGER NOT NULL DEFAULT 0,
    "dismissedCount" INTEGER NOT NULL DEFAULT 0,
    "reasoning" TEXT,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "ScoutRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoutFinding" (
    "id" TEXT NOT NULL,
    "scoutId" TEXT NOT NULL,
    "scoutRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "FindingType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceName" TEXT NOT NULL,
    "relevanceScore" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "itemId" TEXT,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ScoutFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoutActivity" (
    "id" TEXT NOT NULL,
    "scoutId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "ScoutActivityType" NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "ScoutActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scout_userId_status_idx" ON "Scout"("userId", "status");

-- CreateIndex
CREATE INDEX "Scout_status_nextRunAt_idx" ON "Scout"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "ScoutRun_scoutId_createdAt_idx" ON "ScoutRun"("scoutId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoutRun_status_createdAt_idx" ON "ScoutRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScoutFinding_itemId_key" ON "ScoutFinding"("itemId");

-- CreateIndex
CREATE INDEX "ScoutFinding_scoutId_createdAt_idx" ON "ScoutFinding"("scoutId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoutActivity_scoutId_createdAt_idx" ON "ScoutActivity"("scoutId", "createdAt");

-- AddForeignKey
ALTER TABLE "Scout" ADD CONSTRAINT "Scout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutRun" ADD CONSTRAINT "ScoutRun_scoutId_fkey" FOREIGN KEY ("scoutId") REFERENCES "Scout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutFinding" ADD CONSTRAINT "ScoutFinding_scoutId_fkey" FOREIGN KEY ("scoutId") REFERENCES "Scout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutFinding" ADD CONSTRAINT "ScoutFinding_scoutRunId_fkey" FOREIGN KEY ("scoutRunId") REFERENCES "ScoutRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutFinding" ADD CONSTRAINT "ScoutFinding_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutActivity" ADD CONSTRAINT "ScoutActivity_scoutId_fkey" FOREIGN KEY ("scoutId") REFERENCES "Scout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
