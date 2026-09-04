# Handoff — 2026-09-04

Everything below is committed and pushed to `main`.

## Running it

```bash
pnpm install
docker compose up -d          # Postgres on host port 55432
cp .env.example .env          # add ANTHROPIC_API_KEY (+ ANTHROPIC_WORKSPACE_ID if the key is identity-linked)
pnpm db:migrate && pnpm db:seed
pnpm --filter @civic/db seed:fixture   # synthetic Nov 2027 Dallas data
pnpm dev                      # api :4000, web :3007
```

Ports are deliberate. 5432-5439 and 3000 are crowded on this machine and both
collided silently mid-build — a foreign Postgres answered as an auth failure, and a
foreign Next app answered as the wrong site.

## State

| | |
|---|---|
| Data spine | Schema, migrations, 20-issue taxonomy with written descriptions, synthetic Dallas fixture |
| Extraction | Live. `pnpm --filter @civic/extract smoke` runs a document through opus-5 + sonnet-5, reconciles, asserts quote fidelity. ~3.3¢ per pair |
| API | 12 endpoints, 8 contract tests including "`/v1` never returns a non-PUBLISHED position" |
| Web | 12 routes, verified in a real browser at 375px |
| Tests | 27 across core / extract / api |

## What is real and what is not

The **fixture is synthetic**. Seven invented candidates. The offices, districts,
election date and taxonomy are real; the people and their words are not, and
`packages/db/src/fixtures/` must never be promoted to production data.

**No real position has ever been extracted.** The pipeline works end to end against a
synthetic document. It has never seen a real candidate's website.

## Phase 0 — still open

1. **Legal entity. Blocking.** Civic has no entity and no funding model. IRS Rev. Rul.
   78-248 / 2007-41 require candidate answers be *unedited* and bar the org from stating
   its own position — an LLM-written summary is editing, and a weighted quiz ranking named
   candidates is close to candidate rating. Under a c3 that is exposure in a 2028 Texas
   cycle; under an LLC every grant source in this category closes. TRAIGA (effective
   2026-01-01, penalties to $100k) is an untested surface for exactly this product.
   Get a Texas nonprofit/election-law opinion before building further.
2. **A human second reader on the taxonomy.** The 20 descriptions were audited by a model
   arguing both sides. That is not the same as a person who would vote differently.
3. **`data/manual/2027-11-dallas/SOURCES.md`** — the source inventory, now against a
   November ballot.
4. **Fidelity test.** Hand-label 5 real Dallas candidate sites, run them through
   `extractOnce`, and record stance agreement and quote-validity in `docs/PHASE0_RESULTS.md`.
   The kill criteria in the roadmap still stand.
5. **Which DISD ArcGIS layer is authoritative.** Two public services disagree on the same
   point (District 9 vs District 5); one has all-zero population fields. Ask DISD in
   writing and record the answer.

## Known gaps in what was built

- Address → district is a stub. The home page form posts straight to the election.
- The corrections log renders but nothing has been superseded, so it is empty by design.
- `/report` writes a UserReport; no admin surface reads them yet.
- Roll-call votes have a schema and a UI section but no ingest adapter.
- No Playwright suite. Browser verification so far has been manual and programmatic.
- Review console (`/admin`) is not built. Phase 2.

## Reference

- `docs/RESEARCH_2026-09.md` — 409 sources; competitors, experts, white space, and the
  corrections a critic made to the sweep.
- `docs/DESIGN.md` — the visual system, and the one spec in it that is wrong.
- `docs/ROADMAP.md` — phases, now on the corrected November 2027 calendar.
- `docs/TAXONOMY_CHANGELOG.md` — entries 0001-0004.
