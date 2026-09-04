-- CreateEnum
CREATE TYPE "RosterStatus" AS ENUM ('UNKNOWN', 'FILING_OPEN', 'FILING_CLOSED', 'CERTIFIED', 'CANCELLED_UNOPPOSED', 'FROZEN');

-- CreateEnum
CREATE TYPE "IngestStatus" AS ENUM ('OK', 'NOT_MODIFIED', 'FAILED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "DiffVerdict" AS ENUM ('AUTO_APPLIED', 'QUARANTINED', 'ACCEPTED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CandidacyStatus" ADD VALUE 'DISQUALIFIED';
ALTER TYPE "CandidacyStatus" ADD VALUE 'REINSTATED';
ALTER TYPE "CandidacyStatus" ADD VALUE 'CANCELLED_UNOPPOSED';

-- AlterTable
ALTER TABLE "Candidacy" ADD COLUMN     "certifiedAt" TIMESTAMP(3),
ADD COLUMN     "filedAt" TIMESTAMP(3),
ADD COLUMN     "firstObservedAt" TIMESTAMP(3),
ADD COLUMN     "isPlaceholder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isWriteIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastObservedAt" TIMESTAMP(3),
ADD COLUMN     "observedSourceUrl" TEXT,
ADD COLUMN     "withdrawalSourceUrl" TEXT,
ADD COLUMN     "withdrawnAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Election" ADD COLUMN     "certifiedAt" TIMESTAMP(3),
ADD COLUMN     "datesDerivedFrom" TEXT,
ADD COLUMN     "filingDeadline" TIMESTAMP(3),
ADD COLUMN     "filingOpensAt" TIMESTAMP(3),
ADD COLUMN     "parentElectionId" TEXT,
ADD COLUMN     "rosterFrozenAt" TIMESTAMP(3),
ADD COLUMN     "withdrawalDeadline" TIMESTAMP(3),
ADD COLUMN     "writeInFilingDeadline" TIMESTAMP(3),
ADD COLUMN     "writeInWithdrawalDeadline" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Race" ADD COLUMN     "cancelledReason" TEXT,
ADD COLUMN     "expectedCandidateCount" INTEGER,
ADD COLUMN     "rosterStatus" "RosterStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "seatsToElect" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "IngestRun" (
    "id" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "electionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "IngestStatus" NOT NULL DEFAULT 'OK',
    "fetchCount" INTEGER NOT NULL DEFAULT 0,
    "changedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "IngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchTarget" (
    "id" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "etag" TEXT,
    "lastModified" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastChangedAt" TIMESTAMP(3),
    "normalizedHash" TEXT,
    "expectedMarker" TEXT NOT NULL,
    "knownSoftNotFoundHashes" TEXT[],
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WatchTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterSnapshot" (
    "id" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "ingestRunId" TEXT,
    "adapter" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "candidateCount" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RosterSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterDiff" (
    "id" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "fromSnapshotId" TEXT,
    "toSnapshotId" TEXT NOT NULL,
    "added" TEXT[],
    "removed" TEXT[],
    "changed" JSONB,
    "verdict" "DiffVerdict" NOT NULL,
    "reviewTaskId" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterDiff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatUpForElection" (
    "id" TEXT NOT NULL,
    "officeId" TEXT NOT NULL,
    "electionId" TEXT NOT NULL,
    "isUp" BOOLEAN NOT NULL,
    "authority" TEXT NOT NULL,
    "authorityUrl" TEXT,
    "enteredBy" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "SeatUpForElection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestRun_adapter_startedAt_idx" ON "IngestRun"("adapter", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchTarget_url_key" ON "WatchTarget"("url");

-- CreateIndex
CREATE INDEX "WatchTarget_adapter_idx" ON "WatchTarget"("adapter");

-- CreateIndex
CREATE INDEX "RosterSnapshot_raceId_observedAt_idx" ON "RosterSnapshot"("raceId", "observedAt");

-- CreateIndex
CREATE INDEX "RosterDiff_raceId_createdAt_idx" ON "RosterDiff"("raceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeatUpForElection_officeId_electionId_key" ON "SeatUpForElection"("officeId", "electionId");

-- AddForeignKey
ALTER TABLE "Election" ADD CONSTRAINT "Election_parentElectionId_fkey" FOREIGN KEY ("parentElectionId") REFERENCES "Election"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSnapshot" ADD CONSTRAINT "RosterSnapshot_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterSnapshot" ADD CONSTRAINT "RosterSnapshot_ingestRunId_fkey" FOREIGN KEY ("ingestRunId") REFERENCES "IngestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterDiff" ADD CONSTRAINT "RosterDiff_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterDiff" ADD CONSTRAINT "RosterDiff_fromSnapshotId_fkey" FOREIGN KEY ("fromSnapshotId") REFERENCES "RosterSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterDiff" ADD CONSTRAINT "RosterDiff_toSnapshotId_fkey" FOREIGN KEY ("toSnapshotId") REFERENCES "RosterSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatUpForElection" ADD CONSTRAINT "SeatUpForElection_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatUpForElection" ADD CONSTRAINT "SeatUpForElection_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

