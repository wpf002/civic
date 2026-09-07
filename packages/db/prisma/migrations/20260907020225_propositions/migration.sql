-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "propositionId" TEXT;

-- CreateTable
CREATE TABLE "Proposition" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "text" TEXT NOT NULL,
    "yesMeans" TEXT NOT NULL,
    "noMeans" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "Proposition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Proposition_issueId_isCurrent_idx" ON "Proposition"("issueId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "Proposition_issueId_version_key" ON "Proposition"("issueId", "version");

-- AddForeignKey
ALTER TABLE "Proposition" ADD CONSTRAINT "Proposition_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_propositionId_fkey" FOREIGN KEY ("propositionId") REFERENCES "Proposition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
