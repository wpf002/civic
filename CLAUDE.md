# Civic — standing instructions

Issue-first voter guide. The product is the `Position` table: `candidate × issue` with stance, summary, verbatim quote, source URL. Everything the user sees is a view over it.

- Stack is fixed: TypeScript, pnpm, Turborepo, Next.js (app router), Fastify, Prisma, Postgres, Railway. Do not introduce Go, Python, Rust, GraphQL, tRPC, Supabase, Firebase, Drizzle, or a second ORM.
- All model calls go through `packages/extract/src/llm.ts`. That is the only file allowed to import an AI vendor SDK; `no-vendor-sdk.test.ts` enforces it. Never import `@anthropic-ai/sdk` anywhere else.
- Position rows are immutable once PUBLISHED. Corrections create a new row with `supersedesId`. Never UPDATE stance/summary/evidence on a PUBLISHED row.
- Only PUBLISHED positions are readable from `/v1`. Enforce in the query, not the UI.
- Every Position needs >= 1 Evidence row with a verbatim quote that passes exact substring match against the archived source text. Extractor output that fails this check is rejected, never stored.
- The matcher (`packages/core/src/match.ts`) is deterministic and has no I/O. Same inputs, same output, always.
- Quiz answers are never persisted. `/v1/match` is stateless. No analytics event may contain answer values.
- NO_STATED_POSITION is a real value and is shown to users as "no stated position." Never fill it from party, endorsements, or other candidates.
- Issue taxonomy lives in `packages/db/src/seed.ts`. Adding/renaming an issue requires a line in `docs/TAXONOMY_CHANGELOG.md`.
- Local race data comes from `data/manual/*.csv` via the manual adapter. Do not scrape city/county sites without an adapter and a fixture test.
- No user accounts, comments, likes, follows, or notifications until Phase 6. If a task seems to need them, stop and ask.
- Every phase in `docs/ROADMAP.md` has acceptance criteria. Do not start the next phase until they pass.
