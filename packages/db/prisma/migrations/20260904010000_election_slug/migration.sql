-- Add the route slug. Nullable first so the existing fixture row can be backfilled,
-- then tightened to NOT NULL — Prisma's generated version would fail on a populated table.
ALTER TABLE "Election" ADD COLUMN "slug" TEXT;

UPDATE "Election"
SET "slug" = to_char("electionDate", 'YYYY-MM') || '-' || lower(split_part("name", ' ', 1))
WHERE "slug" IS NULL;

ALTER TABLE "Election" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Election_slug_key" ON "Election"("slug");
