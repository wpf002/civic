-- CreateEnum
CREATE TYPE "PlanLookup" AS ENUM ('BLOCKS', 'SHAPES', 'UNRESOLVABLE');

-- AlterTable
ALTER TABLE "DistrictPlan" ADD COLUMN     "lookup" "PlanLookup" NOT NULL DEFAULT 'BLOCKS';

-- CreateTable
CREATE TABLE "DistrictShape" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "minLon" DOUBLE PRECISION NOT NULL,
    "minLat" DOUBLE PRECISION NOT NULL,
    "maxLon" DOUBLE PRECISION NOT NULL,
    "maxLat" DOUBLE PRECISION NOT NULL,
    "polygons" JSONB NOT NULL,

    CONSTRAINT "DistrictShape_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DistrictShape_planId_idx" ON "DistrictShape"("planId");

-- AddForeignKey
ALTER TABLE "DistrictShape" ADD CONSTRAINT "DistrictShape_planId_fkey" FOREIGN KEY ("planId") REFERENCES "DistrictPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
