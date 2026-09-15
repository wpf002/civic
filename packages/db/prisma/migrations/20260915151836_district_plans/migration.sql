-- CreateEnum
CREATE TYPE "PlanChamber" AS ENUM ('CONGRESS', 'STATE_UPPER', 'STATE_LOWER');

-- CreateTable
CREATE TABLE "DistrictPlan" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "chamber" "PlanChamber" NOT NULL,
    "name" TEXT NOT NULL,
    "firstElection" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "blockCount" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistrictPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockAssignment" (
    "planId" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "district" TEXT NOT NULL,

    CONSTRAINT "BlockAssignment_pkey" PRIMARY KEY ("planId","block")
);

-- CreateIndex
CREATE UNIQUE INDEX "DistrictPlan_state_chamber_name_key" ON "DistrictPlan"("state", "chamber", "name");

-- AddForeignKey
ALTER TABLE "BlockAssignment" ADD CONSTRAINT "BlockAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DistrictPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
