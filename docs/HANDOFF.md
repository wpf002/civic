# Handoff

Everything below is committed and pushed to `main`.

## Running it

```bash
pnpm install
docker compose up -d                    # Postgres on host port 55432
cp .env.example .env                    # add ANTHROPIC_API_KEY, set a real ADMIN_TOKEN
pnpm db:migrate && pnpm db:seed
pnpm --filter @civic/db seed:fixture    # synthetic Nov 2027 Dallas data
pnpm dev                                # api :4000, web :3007
```

Ports are deliberate. 5432–5439 and 3000 are crowded on this machine and both collided
silently mid-build: a foreign Postgres answered as an auth failure, a foreign Next app
answered as the wrong site.

If a client-side page stops working in dev, `rm -rf apps/web/.next` and restart — a
`pnpm build` run while `next dev` is up clobbers the dev server's chunks and the symptom
is a page that renders but never hydrates.

## State

| | |
|---|---|
| Tests | 96 unit/integration + 9 Playwright, all green |
| Web | 13 routes incl. the review console, verified at 375px |
| API | `/v1` public read, `/admin` review; contract tests pin "never returns a non-PUBLISHED position" |
| Ingest | Statutory calendar, address→district, DISD and City Secretary roster adapters, shrink guard, persistence |
| Extraction | Live. Two models, reconcile, DRAFT + review task. ~3–5¢ per source pair |

## What is real and what is not

The **fixture is synthetic** — seven invented candidates. The offices, districts,
election date and taxonomy are real; the people and their words are not, and
`packages/db/src/fixtures/` must never be promoted to production data.

**The ingest adapters read real, live pages.** `cli roster --adapter dallas-isd
--election 2026-05-02` returns five real candidates. The City Secretary parser
reconciles the real 2025 filings against the real certified ballot order.

**No real position has ever been extracted.** The pipeline works end to end against
synthetic documents and one live dry run over a fixture source. It has never read a real
candidate's website.

## Open, in order

1. **Legal entity. Blocking.** IRS Rev. Rul. 78-248 / 2007-41 require candidate answers
   be *unedited* and bar the org from stating its own position — an LLM-written summary
   is editing, and a weighted quiz ranking named candidates is close to candidate rating.
   Under a c3 that is exposure in a 2028 Texas cycle; under an LLC every grant source in
   this category closes. TRAIGA (effective 2026-01-01, penalties to $100k) is an untested
   surface for exactly this product. Get a Texas election-law opinion before more building.
2. **A human second reader on the taxonomy.** The 20 issue descriptions were audited by a
   model arguing both sides. That is not the same as a person who would vote differently.
3. **`SeatUpForElection` rows for November 2027.** Which of the 15 council seats and which
   5 of 9 trustee seats are up is set by resolution 25-1776 and its DISD counterpart, is
   derivable from no machine-readable source, and is the denominator every completeness
   check runs against. A human enters it with the citation.
4. **Real auth on `/admin`.** It is a shared secret in an httpOnly cookie. The page says
   so out loud. It must be replaced before the pilot.
5. **Phase 0 fidelity test.** Hand-label 5 real Dallas candidate sites, run them through
   `extract run`, record stance agreement and quote validity in `docs/PHASE0_RESULTS.md`.
   The kill criteria in the roadmap still stand.
6. **Railway cron wiring.** The commands and schedules exist (`railway.ingest.json`); the
   jobs are not configured.

## Known gaps in what was built

- Address → district resolves correctly but is not wired to the home page form.
- The corrections log renders and is empty by design — nothing has been superseded.
- Roll-call votes have a schema and a UI section but no ingest adapter.
- `/report` writes a UserReport; the review console does not read them yet.
- The City Secretary adapter parses but does not yet persist. The blocker is a naming
  reconciliation, not the parser: the fixture models council seats as "District 7" while
  the certified ballot prints "Place 7", and the GIS layer returns `DISTRICT`. Both terms
  are genuinely in use and the Race lookup needs to hold both before it can resolve.

## Reference

- `docs/INGEST.md` — where real data comes from, what is automatable, and what is not.
- `docs/RESEARCH_2026-09.md` — 409 sources: competitors, experts, white space.
- `docs/DESIGN.md` — the visual system, and the one spec in it that is wrong.
- `docs/ROADMAP.md` — phases, on the corrected November 2027 calendar.
- `docs/EDITORIAL_POLICY.md` — including the summary style guide.
- `docs/TAXONOMY_CHANGELOG.md` — entries 0001–0004.
