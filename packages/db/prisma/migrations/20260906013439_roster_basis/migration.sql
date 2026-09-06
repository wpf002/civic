-- CreateEnum
CREATE TYPE "RosterBasis" AS ENUM ('FILED', 'CERTIFIED');

-- AlterTable
ALTER TABLE "RosterSnapshot" ADD COLUMN     "basis" "RosterBasis" NOT NULL DEFAULT 'FILED';

-- CreateIndex
CREATE INDEX "RosterSnapshot_raceId_basis_observedAt_idx" ON "RosterSnapshot"("raceId", "basis", "observedAt");
