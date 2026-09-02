# Civic

See where every candidate on your ballot stands on the issues you care about. With the quote and the source.

## What it does
- Browse by issue → every candidate in your election, their stance, their words, the link
- Candidate pages → all published positions, voting record for incumbents, coverage disclosure
- Match quiz → 10-15 questions, weighted, deterministic ranking with a coverage score
- Share card → one image, your top issues and closest matches

## What it deliberately doesn't do
No accounts. No comments. No inferred positions. No "we think." If a candidate hasn't said, it says "no stated position."

## How positions get in
1. `ingest` pulls candidate lists and source documents (sites, questionnaires, votes, transcripts)
2. `extract` runs each source through two independent models. Agreement → DRAFT. Disagreement → review queue
3. A human publishes. Every published position has a verbatim quote that string-matches the archived source
4. Corrections supersede; history is public

## Stack
TypeScript · pnpm · Turborepo · Next.js · Fastify · Prisma · Postgres · Railway · Anthropic API

## Dev
```bash
pnpm install
docker compose up -d
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev
```

## Layout
`apps/api` · `apps/web` · `packages/db` · `packages/core` · `packages/ingest` · `packages/extract` · `data/manual` · `docs`

## Editorial policy
See `docs/EDITORIAL_POLICY.md`. Read it before touching the taxonomy, question wording, or summary style.
