-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "BillProposition" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "propositionId" TEXT NOT NULL,
    "yeaMeans" "Stance" NOT NULL,
    "basis" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "status" "MappingStatus" NOT NULL DEFAULT 'PROPOSED',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillProposition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillProposition_status_idx" ON "BillProposition"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BillProposition_billId_propositionId_key" ON "BillProposition"("billId", "propositionId");

-- AddForeignKey
ALTER TABLE "BillProposition" ADD CONSTRAINT "BillProposition_propositionId_fkey" FOREIGN KEY ("propositionId") REFERENCES "Proposition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
