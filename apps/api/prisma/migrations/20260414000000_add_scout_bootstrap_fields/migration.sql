-- AlterTable: add mode to ScoutRun
ALTER TABLE "ScoutRun" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'standard';

-- AlterTable: add bootstrapped to Scout
ALTER TABLE "Scout" ADD COLUMN "bootstrapped" BOOLEAN NOT NULL DEFAULT false;

-- AlterEnum: add bootstrap_completed to ScoutActivityType
ALTER TYPE "ScoutActivityType" ADD VALUE 'bootstrap_completed';
