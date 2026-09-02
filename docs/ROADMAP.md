# Civic — Build Roadmap

Issue-first voter guide. A user picks an issue and sees where every candidate on their ballot stands, with the exact quote and source. Built for young and first-time voters. Nonpartisan by mechanism, not by claim.

Repo: `wpf002/civic`. Stack: TypeScript, pnpm, Turborepo, Next.js, Fastify, Prisma, Postgres, Railway. AI calls go through Flint. Multi-model extraction cross-checks use the Trident pattern.

---

## 0. What this is and isn't

**Is:** a structured database of candidate positions with provenance, and a thin mobile-web layer that lets someone look up an issue, compare candidates, take a short match quiz, and share the result.

**Isn't:** a news app, a social network, a chatbot, a registration tool (that's an integration), or a place where users argue. No accounts in v1. No comments ever.

**The product is the Position table.** Everything the user sees is a view over `candidate × issue`, with `stance`, `summary`, `quote`, `sourceUrl`, `publishedAt`. If that table is accurate and covered, the app works. If it isn't, nothing else matters.

**Timeline reality.** Midterms are Nov 3, 2026. Not shippable by then. Targets:

- **May 1, 2027 Dallas municipal election** (City Council all 14 districts + mayor is 2027, DISD trustee seats). Pilot. Small candidate pool, no APIs, worst-case data problem on purpose.
- **March 2028 Texas primary, Nov 2028 general.** Real launch. Federal + state + Dallas County.

---

## 1. Standing instructions for Claude Code

Paste these into `CLAUDE.md` at the repo root.

```
- Stack is fixed: TypeScript, pnpm, Turborepo, Next.js (app router), Fastify, Prisma, Postgres, Railway. Do not introduce Go, Python, Rust, GraphQL, tRPC, Supabase, Firebase, Drizzle, or a second ORM.
- All model calls go through @civic/extract/src/flint.ts. Never import an AI vendor SDK anywhere in this repo.
- Position rows are immutable once PUBLISHED. Corrections create a new row with supersedesId. Never UPDATE stance/summary/evidence on a PUBLISHED row.
- Only PUBLISHED positions are readable from /v1. Enforce in the query, not the UI.
- Every Position needs >= 1 Evidence row with a verbatim quote that passes exact substring match against the archived source text. Extractor output that fails this check is rejected, never stored.
- The matcher (@civic/core/src/match.ts) is deterministic and has no I/O. Same inputs, same output, always.
- Quiz answers are never persisted. /v1/match is stateless. No analytics event may contain answer values.
- NO_STATED_POSITION is a real value and is shown to users as "no stated position." Never fill it from party, endorsements, or other candidates.
- Issue taxonomy lives in packages/db/src/seed.ts. Adding/renaming an issue requires a line in docs/TAXONOMY_CHANGELOG.md.
- Local race data comes from data/manual/*.csv via the manual adapter. Do not scrape city/county sites without an adapter and a fixture test.
- No user accounts, comments, likes, follows, or notifications until Phase 6. If a task seems to need them, stop and ask.
- Every phase has acceptance criteria below. Do not start the next phase until they pass.
```

---

## 2. GitHub repo setup

```bash
mkdir civic && cd civic
git init -b main
gh repo create wpf002/civic --private --source=. --remote=origin
# or: git remote add origin git@github.com:wpf002/civic.git

# run bootstrap
bash ../bootstrap.sh

git add -A
git commit -m "chore: bootstrap civic monorepo"
git push -u origin main

# branch protection once CI exists
gh api repos/wpf002/civic/branches/main/protection -X PUT \
  -f required_status_checks[strict]=true \
  -f required_status_checks[contexts][]=ci \
  -f enforce_admins=false \
  -f required_pull_request_reviews=null \
  -f restrictions=null
```

Railway:

```bash
railway init            # project: civic
railway add --database postgres
railway service create api
railway service create web
railway variables set --service api DATABASE_URL='${{Postgres.DATABASE_URL}}' FLINT_BASE_URL=... ADMIN_TOKEN=...
railway variables set --service web NEXT_PUBLIC_API_URL=https://<api-domain>
```

Root directory per service: `apps/api` and `apps/web`. Build command `pnpm install --frozen-lockfile && pnpm -w build`. Start `pnpm --filter @civic/api start` / `pnpm --filter @civic/web start`.

---

## 3. Bootstrap script

`bootstrap.sh` ships alongside this doc. It writes:

```
civic/
  apps/
    api/            Fastify. /v1 public read + /match, /admin review console backend
    web/            Next.js mobile-first. Issue browser, candidate pages, quiz, share card
  packages/
    db/             Prisma schema, client, seed (issue taxonomy + parties)
    core/           Stance scale, deterministic matcher, extractor output schemas (zod)
    ingest/         Source adapters (openstates, congress, fec, manual CSV). Produce Sources, never Positions
    extract/        Flint client, extraction prompt, two-model reconcile, review queue writer
  data/manual/      Per-election CSVs for races with no API
  docs/             EDITORIAL_POLICY.md, TAXONOMY_CHANGELOG.md
```

After running: `pnpm install && docker compose up -d && cp .env.example .env && pnpm db:migrate && pnpm db:seed && pnpm test`.

The matcher tests in `packages/core` pass on a clean checkout. Verified.

---

## 4. README scaffold

```markdown
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
2. `extract` runs each source through two models via Flint. Agreement → DRAFT. Disagreement → review queue
3. A human publishes. Every published position has a verbatim quote that string-matches the archived source
4. Corrections supersede; history is public

## Stack
TypeScript · pnpm · Turborepo · Next.js · Fastify · Prisma · Postgres · Railway · Flint (AI seam)

## Dev
pnpm install
docker compose up -d
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev

## Layout
apps/api · apps/web · packages/db · packages/core · packages/ingest · packages/extract · data/manual · docs

## Editorial policy
See docs/EDITORIAL_POLICY.md. Read it before touching the taxonomy, question wording, or summary style.
```

---

## 5. Data model

Schema is in `packages/db/prisma/schema.prisma`. The spine:

```
Jurisdiction (FEDERAL/STATE/COUNTY/CITY/SCHOOL_DISTRICT) ─┬─ District
                                                          └─ Office ── Race ── Election
                                                                          │
                                                             Candidacy ───┘── Candidate ── Incumbency
                                                                                 │
Issue (fixed taxonomy) ─────────────────────────────── Position ── Evidence ── Source
                                                         │
                                                    VoteRecord (incumbents, ingested not extracted)
QuizQuestion → Issue
ReviewTask, ExtractRun, UserReport (ops)
```

Decisions locked:

- **Position is append-only after publish.** `supersedesId` chain is the audit trail.
- **Evidence is verbatim.** Quote ≤ ~60 words, must substring-match the archived source text. Extractor output failing this is dropped, not stored.
- **Source has contentHash.** Same URL re-fetched with changed content is a new Source. Positions point at the version they came from.
- **Stance is a 5-point scale plus NO_STATED_POSITION.** The matcher maps the five to −2..2 and skips NO_STATED entirely. Coverage is reported separately so a candidate with one position never outranks one with twelve.
- **Issues carry `levels[]`.** "Foreign policy" doesn't show on a school board race. "Zoning" doesn't show on a Senate race.
- **VoteRecord is ingested, not extracted.** Roll calls are structured data. The only model involvement is tagging bills to issues, and that goes through review.
- **No User model.** Reports are rate-limited by IP hash. That's the entire user footprint.

---

## 6. Phases

### Phase 0 — Kill gate (2 weeks)

Answer these before any app code past the bootstrap.

1. **Source inventory for the pilot.** List every May 2027 Dallas race. For each, what sources will exist? Candidate sites, Dallas Morning News questionnaires, League of Women Voters guide (VOTE411), forums, council voting records (incumbents), DISD board minutes. Write it down as `data/manual/2027-05-dallas/SOURCES.md`.
2. **Editorial policy signed.** `docs/EDITORIAL_POLICY.md` finalized. Summary style guide with 10 good/bad examples.
3. **Taxonomy frozen for the pilot.** 20 issues in seed.ts, each with a neutral one-paragraph description and a level mask. Reviewed by at least one person who'd vote differently than you.
4. **Extraction fidelity test.** Take 5 real candidate websites from the 2025 Dallas municipal cycle. Hand-label positions. Run the extractor. Measure stance agreement and quote-validity rate.

**Kill criteria:** if extractor stance agreement with hand labels is under 80% on the 5-site test, or under 40% of local candidates have any findable stated positions, the pilot scope changes (fewer races, or a "candidate questionnaire" outreach program becomes Phase 1). Don't build the UI against data that won't exist.

**Acceptance:** SOURCES.md, EDITORIAL_POLICY.md v1, TAXONOMY_CHANGELOG.md with entry 0001, fidelity numbers in `docs/PHASE0_RESULTS.md`.

### Phase 1 — Data spine (4 weeks)

- Migrations applied on Railway Postgres.
- `manual` adapter fully working: reads `candidates.csv` + `sources.csv`, upserts Jurisdiction/Office/Race/Candidate/Candidacy, fetches each source URL, normalizes to text, hashes, archives raw HTML/PDF to Railway volume or R2, writes Source rows.
- `openstates` adapter: Texas legislators, districts, bills, votes → Incumbency + VoteRecord.
- `congress` adapter (Congress.gov API): TX delegation, roll calls → VoteRecord.
- `fec` adapter: federal candidate list for TX, external IDs only.
- Address → districts: Census Geocoder (free) returns state/county/place/CD/SLDU/SLDL GEOIDs. Map GEOID → District rows. Dallas council and DISD districts need boundary shapefiles from the city GIS portal loaded into PostGIS. (Google Civic's Representatives endpoint is gone; I'm fairly sure it shut down in 2025. Don't plan on it.)
- Admin: Prisma Studio is enough. No custom admin UI yet.

**Acceptance:** `pnpm ingest candidates --adapter manual --state TX --election 2027-05-01` populates every Dallas council + DISD race. `pnpm ingest documents --adapter manual` archives ≥ 1 source per declared candidate or logs a named gap. Address lookup returns correct council district for 20 test addresses. Zero Position rows exist yet.

### Phase 2 — Extraction pipeline (4 weeks)

- Flint task `civic.extract_positions` registered with the zod schema from `@civic/core`.
- `extract run --all-unprocessed`: for each Source, `extractOnce` with model A and model B, `reconcile`, write agreed → Position DRAFT, flagged → ReviewTask. Record ExtractRun with cost.
- Quote validation is the hard gate. Failed quotes are logged with the source and never stored.
- Vote tagging: `civic.tag_votes` maps VoteRecord.billTitle → issueSlugs, always through review.
- Review console: `apps/web/src/app/admin/*` behind ADMIN_TOKEN. Queue view, side-by-side model outputs on disagreement, one-click publish/reject/edit-then-publish. Editing creates a new DRAFT with `extractedBy: "human"`.
- Re-extraction: when a Source's contentHash changes, old positions from that Source get a ReviewTask "source changed."

**Acceptance:** Full Phase 0 fidelity set re-run through the pipeline; ≥ 85% stance agreement with hand labels on agreed outputs, 100% quote validity on stored rows. Review queue clears the Dallas pilot set in under 4 hours of human time. Per-candidate cost under $2.

### Phase 3 — Public MVP, mobile web (5 weeks)

Mobile web, not native. Shareable by link. No App Store gate.

Routes:

- `/` → "Where do you vote?" address input → election picker (only elections with published data)
- `/e/[election]` → issue grid, filtered by level mask
- `/e/[election]/i/[issue]` → every candidate in the election, stance chip, one-line summary, expandable quote + source link. NO_STATED shown explicitly.
- `/c/[slug]` → candidate page: office, party, all published positions, voting record if incumbent, coverage bar ("positions found on 11 of 16 issues"), "report a problem" link
- `/e/[election]/quiz` → 10-15 QuizQuestions, 5-point answer, importance weight, no persistence. Results computed client-side from `/v1/match` response. Shows match %, coverage %, per-issue breakdown.
- `/e/[election]/quiz/card` → OG-image share card via `next/og`: top 3 issues, top 2 matches, coverage caveat, QR to the election page. Nothing about the user is in the URL. Card is generated from state passed in a signed, expiring query param that contains only issue slugs and candidate slugs.

Rules: every stance chip has a source link one tap away. Every candidate row shows a coverage number. No candidate photo cropping, filtering, or ordering that isn't alphabetical or ballot order.

**Acceptance:** Lighthouse mobile ≥ 90 performance, ≥ 95 accessibility. Quiz completes in under 2 minutes on a phone. Share card renders in < 1s. Zero server-side storage of answers (verified by DB inspection after a test session). Playwright smoke suite green.

### Phase 4 — Dallas pilot (Feb–May 2027)

- Data freeze T-3 weeks before election; post-freeze changes go through supersede + public changelog.
- Outreach: UNT Dallas, SMU, UT Dallas, Dallas College student governments and campus papers. Tabling at registration drives. Give student journalists admin read access to the review history.
- Candidate outreach: email every candidate a link to their own page with a "correct this" form that creates a ReviewTask. Log who responds.
- Metrics (no user tracking): quiz starts/completes, share card renders, candidate page views, report submissions. Plausible or self-hosted, no cookies.

**Targets:** 2,000 quiz completions, ≥ 15% card share rate, ≥ 1 campus paper article, candidate correction response rate ≥ 25%, published-data error rate found by users < 2%.

**Post-pilot:** `docs/PILOT_RETRO.md`. What data was missing, what users reported, what the review queue cost in hours.

### Phase 5 — Off-cycle retention (Jun–Dec 2027)

The business dies in odd years unless there's a reason to come back.

- `/me` → "My representatives" from address: every current officeholder from city council to U.S. Senate. Their positions, their recent votes tagged by issue.
- Vote digest: weekly page (no email, no accounts) per district showing how your reps voted on tagged bills. Static-generated.
- Texas Legislature is out of session in 2027, so this is mostly Congress + Dallas council + DISD board.
- Expand `openstates` + `congress` ingest to run on a schedule (Railway cron).

**Acceptance:** Address → full rep list correct for 50 test addresses across Dallas County. Weekly digest generates without manual work.

### Phase 6 — 2028 expansion (Dec 2027–Oct 2028)

- Geography: all of Texas for federal + state; Dallas, Tarrant, Collin, Denton, Harris, Travis counties for local.
- Sources: add VOTE411 (LWV) questionnaire adapter, Ballotpedia survey adapter, debate transcript ingestion.
- Native apps: only if pilot share-rate data says push notifications would move retention. Otherwise PWA + add-to-homescreen.
- Registration: VoteAmerica or Rock the Vote embed. No data passes through Civic.
- Chatbot: RAG over the Position table only, via Flint. Answers cite Position IDs. Refuses anything not in the table. Not before this phase.
- Team: 2-3 part-time researchers (poli-sci students) on the review queue. Budget it.

**Acceptance:** ≥ 90% of Texas state legislative candidates have ≥ 5 published positions by T-6 weeks before the March primary. Review queue SLA < 72h. Chatbot hallucination rate 0 on a 200-question eval (measured as "cited a position that doesn't exist").

---

## 7. Cross-cutting workstreams

**Testing.** Matcher: property tests (monotonic in agreement, permutation-invariant). Extractor: fixture sources with expected outputs, run in CI without model calls by replaying recorded Flint responses. API: contract tests that `/v1` never returns a non-PUBLISHED position. Web: Playwright for issue → candidate → quiz → card.

**Security.** Admin routes behind real auth before the pilot (Clerk or Auth.js, admin-only, no public sign-up). Rate limits on `/match` and `/report`. CSP, no third-party scripts except analytics. Archived sources are read-only. Your offsec background is relevant here: assume campaigns will try to poison sources (edit their site the day before freeze, submit fake corrections). ContentHash + freeze + supersede history is the defense; document it.

**Nonpartisanship as mechanism.** Same source-gathering checklist per candidate, logged. Alphabetical or ballot order only. Summary style guide enforced in review. Public changelog. Advisory reviewers from across the spectrum on taxonomy and question wording. Don't say "nonpartisan" anywhere you can't point to the process that makes it true.

**Privacy.** No accounts, no answer storage, no third-party cookies, no address storage (geocode → district, discard). Texas Data Privacy and Security Act applies once you're at scale; being under the data thresholds is the strategy. Political opinions are sensitive data under most frameworks. Never collect them.

**Data ops.** Every ExtractRun logs cost. Monthly report: sources fetched, positions published, review hours, cost per published position. If cost per position is over $5 by the 2028 cycle, the pipeline needs work before scaling geography.

**Design.** Mobile-first, one-thumb, fast. Stance chips are the core visual. Share card is the growth mechanic; get a designer on it before the pilot, it has to look like something people want on their story. No party colors as UI colors.

---

## 8. Money

Users pay nothing. Options, in order of realism:

1. Grants: Knight Foundation, Democracy Fund, Hewlett, MacArthur civic-tech lines. Apply after the pilot with real numbers.
2. Institutional licensing: universities pay for a campus-branded deployment; county election offices license the local-race dataset.
3. Data licensing: the Position table with provenance is a product. Newsrooms and academics will pay for structured, sourced local candidate data. Nobody has it.
4. Nonprofit sponsorship: LWV-style orgs distribute it to members.

Not ads. Ads on a political app is a bias story waiting to happen.

Phase 0 through pilot runs on your time plus maybe $5-10K (researchers, designer, Flint spend). 2028 needs grant or license revenue to fund researchers.

---

## 9. Risks

| Risk | Signal | Response |
|---|---|---|
| Local candidates have no stated positions | Phase 0 test < 40% coverage | Candidate questionnaire program becomes core; NO_STATED shown prominently |
| Extractor mislabels stance | Fidelity < 80% | Single-model → two-model → three-model with majority; more human review; narrower issue set |
| Bias accusation | Any | Point at process, logs, changelog. Never argue positions. |
| Source poisoning near freeze | ContentHash changes on many sources in final week | Freeze is hard; post-freeze changes flagged publicly |
| Nobody shares the card | Pilot share rate < 5% | Card design, not product. Iterate the card. |
| Odd-year death | Traffic → 0 after May 2027 | Phase 5 exists for this. If `/me` doesn't retain, reconsider the whole thing as a per-election utility with grant funding only. |
| Review queue cost | > $5 / published position | Better source targeting, questionnaire program, fewer issues per level |

---

## 10. First week

1. Run bootstrap, push, Railway up, migrations applied.
2. Write `data/manual/2027-05-dallas/SOURCES.md` from the 2025 Dallas municipal cycle as a proxy.
3. Hand-label 5 candidate sites.
4. Wire `extractOnce` to Flint and run the fidelity test.
5. Read the number. Decide.
