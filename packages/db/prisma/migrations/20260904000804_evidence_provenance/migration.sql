/*
  Warnings:

  - You are about to drop the column `fetchedAt` on the `Source` table. All the data in the column will be lost.
  - Added the required column `endOffset` to the `Evidence` table without a default value. This is not possible if the table is not empty.
  - Added the required column `startOffset` to the `Evidence` table without a default value. This is not possible if the table is not empty.
  - Added the required column `text` to the `Source` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tier` to the `Source` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SourceTier" AS ENUM ('OFFICIAL_RECORD', 'CAMPAIGN_PLATFORM', 'QUESTIONNAIRE', 'CANDIDATE_SPEECH', 'CANDIDATE_SOCIAL', 'THIRD_PARTY');

-- AlterEnum
ALTER TYPE "Stance" ADD VALUE 'DECLINED_TO_STATE';

-- AlterTable
ALTER TABLE "Candidacy" ADD COLUMN     "isCertified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "endOffset" INTEGER NOT NULL,
ADD COLUMN     "mediaTimestamp" TEXT,
ADD COLUMN     "startOffset" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Source" DROP COLUMN "fetchedAt",
ADD COLUMN     "candidateId" TEXT,
ADD COLUMN     "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "text" TEXT NOT NULL,
ADD COLUMN     "tier" "SourceTier" NOT NULL;

-- CreateIndex
CREATE INDEX "Source_candidateId_capturedAt_idx" ON "Source"("candidateId", "capturedAt");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
