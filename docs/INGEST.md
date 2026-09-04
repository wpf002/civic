# Ingest — getting real data, and keeping it current

September 2026. Every source below was probed by fetching it, then adversarially
re-checked against one test: *could this have told you the full candidate roster for
Dallas City Council Place 7 in September 2027?*

---

## The honest answer

No — Civic cannot get every US election dynamically, and it cannot get the November 2, 2027 Dallas roster dynamically either: verification found nothing machine-readable that lists that election today, and the two sources that will eventually list it are an IIS directory of scanned PDFs and a school district's CMS page whose slug rotates every cycle. What IS achievable, and is worth building: (1) election existence and the full statutory calendar are 100% deterministic for every Texas uniform-date election — generated from Election Code §41.001(a)(2), §143.007, §146.054, §146.0301(a) with no source and no vendor, so requirement #1 is solved by a pure function; (2) requirement #4, address → exact districts, is fully solved, free and keyless, verified end to end (Census geocoder → City of Dallas `CouncilAreas` → DISD `DISD_Trustee_SMD_Adopted_Dec_16_2021`); (3) roster *fetching and diffing* is fully automatable at daily cadence for both halves of the pilot, and will tell you within 24 hours that Council District 7's field changed — but roster *acceptance* is not automatable, because the City Secretary's filings are pure scans (one extractable character from a 1.4 MB PDF), the certified ballot order disagrees with the filings folder in both directions, and four 2025 districts carried a bare "Write-In Candidate" line with no name; (4) requirement #3, cross-source identity, is solved for federal via FEC + congress-legislators and unsolved for municipal without a Ballotpedia contract, which the pilot does not need because 20 contests can be keyed on district + certified name. The correct architecture is therefore: deterministic dates, automated fetch, automated diff, human acceptance, and a hard rule that no roster row ever enters the database without a fetched artifact or a named human behind it. Two premises confirmed and one corrected: Nov 2, 2027 is right (SB 1494 + council resolution 25-1776, Nov 12 2025); the OpenStates `end_date: 2027-05-06` on Eric Johnson is stale, not a contradiction — it is the holdover the resolution created. Filing closes ~Aug 16, 2027; withdrawal ~Aug 23. But 2027 is a transition election, and which of the 15 city seats and which 5 of 9 DISD seats are actually up is set by resolution and derivable from no source in this investigation. That is a prerequisite for the roster-completeness guarantee, and it has to be a human-entered row with a citation before any adapter runs.

---

## Tiers

| Tier | Source | Automatable | Cadence | Effort |
|---|---|---|---|---|
| Election existence + full statutory calendar, Texas (requirement #1, all tiers) | Deterministic generator over TX Election Code §41.001(a)(2) uniform dates, §143.007 city filing period, §145.092(f)/§145.096(b) withdrawal, §146.054 write-in filing, §146.0301(a) w | Fully. No network call, no vendor, no key. Manual residue: someone must confirm once per quarter that Dallas has not moved the date again — it moved o | Regenerate weekly (Mon 12:00 UTC) and diff against Election rows. Weekly, not daily, because the input is a statute: the | 1–2 days. Pure function, no I/O, unit-testable against the known 2025/2026 calendars. Chea |
| Dallas ISD trustee rosters — 5 of the pilot's ~20 contests | https://www.dallasisd.org/board-of-trustees/elections-information (index) → the per-election "…-general-election-candidates" page discovered from it. Free, keyless, names by truste | Fetch, parse and diff: fully. Acceptance of any removal: never. Manual residue is diff triage only — roughly 20 min/week standing, rising to 45 min th | Daily 11:15 UTC year-round; twice daily (11:15 and 23:15 UTC) from Jul 10 to Aug 30, 2027. Daily because the page says c | 3–4 days. Most of it is not parsing: it is index-discovery (the slug rotates every cycle a |
| Dallas City Council + Mayor rosters — 15 of the pilot's ~20 contests | https://citysecretary2.dallascityhall.com/pdf/Elections/<year>/ — an IIS directory listing with per-file name, size and mtime; `APPS/*.pdf` (filed applications) and `BallotOrder.pd | Partially, and the residue is the real cost. Filenames are machine-readable ("07 - Adam Bazaldua.pdf" gives district + name); the PDFs behind them are | Daily 11:15 UTC; twice daily Jul 10–Aug 30, 2027. Plus a forced full re-fetch daily through election day after certifica | 5–7 days. Directory-listing parse, filename normalization, BallotOrder text extraction, th |
| Which seats are actually up in November 2027 (the transition question) | Dallas City Council Resolution 25-1776 (Nov 12, 2025, reciting SB 1494) and the parallel DISD resolution. Holdover language: sitting members "continue to serve in holdover status a | Not at all. There is no source, machine-readable or otherwise, from which the seat set is derivable — it is set by resolution. This is a prerequisite  | Once, then re-verified quarterly against the City Secretary (the roadmap already requires this for the date; extend it t | 3 h of reading + a `SeatUpForElection` row per office carrying the authority citation, URL |
| Address → districts (requirement #4, all tiers) | Census geocoder (keyless) → City of Dallas ArcGIS `CouncilAreas` FeatureServer/0 (returns COUNCIL/DISTRICT/COUNCILPER) → DISD ArcGIS `DISD_Trustee_SMD_Adopted_Dec_16_2021` FeatureS | Fully, free, keyless. One open manual item: DISD publishes two layers that disagree on the same point, and the other one (`TrusteeDistricts`, internal | Geocode on demand, never stored. Layer schema + a 20-address golden-set regression run monthly. | 2 days. Two traps to encode as tests: `CouncilAreas`, not `CouncilDistrictBorder` (a line  |
| Federal candidates, Texas — 2028 launch only, worth ~zero for the pilot | OpenFEC `/v1/candidates?election_year=2028&state=TX` with a personal key, plus bulk `cn{YY}.zip` for closed cycles. | Fully for *filers*; not at all for *ballot-qualified*; and person-dedupe is unsolved — 16 distinct names in TX 2026 carry multiple candidate_ids, incl | Nightly, via a `load_date` high-water mark. Not relevant before Dec 2027. | 3–4 days, including the `cycle=` vs `election_year=` trap (using `cycle=` returns a silent |
| Federal identity crosswalk | unitedstates/congress-legislators `legislators-current.yaml` (CC0, GitHub Pages serves both ETag and Last-Modified). | Fully, but scope is sitting members only: 539 records, and only 10.3% of the 389 TX 2026 federal filers match a sitting member's fec_id. It solves inc | Daily conditional GET. Effectively free. | Half a day. Congress.gov is not worth an adapter — its member payload carries none of fec/ |
| Texas state legislature incumbency and votes — Phase 5/6 | raw.githubusercontent.com/openstates/people (keyless, CC0) for people; OpenStates v3 with a key for bills and votes. | For incumbents, yes. For candidates, zero. `data/tx/municipalities/` contains exactly one Dallas record across 49 TX municipal files — Eric Johnson, m | Weekly. The TX Legislature is out of session in 2027, so this is dormant for the pilot. | 3 days, deferred. Use one GitHub tree call per run, not one call per file — unauthenticate |
| Texas state candidate rosters — 2028 gap, unsolved | None verified. The SOS candidate pages return 403 (which is that host's not-found response, at a reproducible 20,695 bytes), and no probe in this investigation found a machine-read | Not today. Treat as manual CSV plus a research task with a hard deadline of Dec 2027, before the March 2028 primary calendar makes it urgent. | n/a until a source exists. | Unknown, and that is the honest answer. Budget a week of source discovery, not a week of a |
| Commercial rosters — the only thing that could ever generalize beyond Dallas | Ballotpedia API (`api4.ballotpedia.org`, 403 without a contract). Democracy Works resells it — their own docs say "Ballot data is sourced from Ballotpedia" twice — so it is one dat | Would be fully automatable and carries the thing nothing free has: stable integer ids at every level (`person.id`, `district.id`, `race.id`, `office.i | n/a until an entity exists. Do not plan the pilot around it. | 2 days for a read-only cross-check adapter — after a contract. Ignore `candidate_lists_com |

---

## Adapters

Build order. `buildFirst` adapters are the pilot; the rest are 2028.

### `packages/ingest/src/adapters/tx-uniform-dates.ts`  — **first slice**

Generates Election rows and the full statutory calendar for any Texas uniform-date election: election date, first day to file, filing deadline (78th day), withdrawal deadline (71st), write-in declaration (74th) and write-in withdrawal (71st). For Nov 2, 2027 that yields filing open ~Jul 17, filing close Aug 16, write-in Aug 20, withdrawal Aug 23. Deterministic, no I/O, no vendor, same contract as packages/core/src/match.ts.

- **Endpoint.** None. Pure function over TX Election Code §41.001(a)(2), §143.007, §145.092(f), §146.054, §146.0301(a). Each generated date stores its own citation string.
- **Change detection.** n/a by construction. Output is diffed weekly against existing Election rows; any drift is a bug in our data, not in the statute. Separately, sos.state.tx.us/elections/voter/important-election-dates.shtml is polled on a cheap 304 (ETag verified working) so we notice the day a 2027 calendar appears — and every fetch asserts an expected marker first, because that host returns 403 as its not-found response at a reproducible 20,695 bytes.

### `packages/ingest/src/adapters/dallas-isd.ts`  — **first slice**

Discovers the current election's candidates page from the DISD elections index, parses named candidates by trustee district, and emits a RosterSnapshot. Models Certificate of Withdrawal and Order of Cancellation (unopposed seat) as explicit roster events rather than as absences. Covers 5 of the pilot's ~20 contests.

- **Endpoint.** https://www.dallasisd.org/board-of-trustees/elections-information → the linked "…-general-election-candidates" page. Never hardcode the slug (it rotates each cycle) and never trust the <title> (the May 2025 page still titles itself May 4, 2024).
- **Change detection.** Conditional GET, then normalized hash. The body must be normalized by stripping the Cloudflare `__CF$cv$params` token before hashing — unstripped, the hash changes on every poll at identical byte count and the adapter alarms forever.

### `packages/ingest/src/adapters/dallas-city-secretary.ts`  — **first slice**

Parses the IIS directory listing for the election year, derives (district, filed name) from APPS/ PDF filenames, extracts the certified field and ballot order from BallotOrder.pdf, and runs the filed-vs-certified diff as a first-class output. Covers 15 of the pilot's ~20 contests. Does not attempt to read the application PDFs — they are scans.

- **Endpoint.** https://citysecretary2.dallascityhall.com/pdf/Elections/<year>/ , plus <year>/APPS/ and <year>/BallotOrder.pdf. /pdf/Elections/2027/ currently 404s; the adapter must treat a missing year folder as "not yet published," never as an empty roster.
- **Change detection.** Per-file name+size+mtime from the directory listing is primary; If-None-Match and If-Modified-Since both return 304/0 bytes on this host (verified). Never content-hash any dallascityhall.com ASPX page: serverTime at sub-second precision, __VIEWSTATE and __REQUESTDIGEST all rotate per request, so naive hashing false-positives on every poll. Node needs the missing issuer intermediate pinned via NODE_EXTRA_CA_CERTS — a curl smoke test will pass and lie to you.

### `packages/ingest/src/adapters/manual.ts`  — **first slice**

Reads the reviewed roster of record — data/manual/2027-11-dallas/{seats,candidates,sources}.csv — and upserts Jurisdiction/Office/Race/Candidate/Candidacy. This is the only adapter permitted to write a published Candidacy for the pilot. Every other adapter writes proposals against it, never over it. seats.csv carries the SeatUpForElection rows with their resolution citation.

- **Endpoint.** Local filesystem, versioned in git.
- **Change detection.** Git history is the audit trail. Every row carries sourceUrl, observedAt and enteredBy; a row without a sourceUrl fails the fixture test.

### `packages/ingest/src/adapters/census-geocoder.ts`  — **first slice**

Address → lat/lon + state/county/place/CD/SLDU/SLDL GEOIDs. Requirement #4, first half. Address is discarded immediately after the district resolve; only the district ids persist.

- **Endpoint.** https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress (keyless)
- **Change detection.** Vintage is pinned per election and stored on the lookup. A vintage change is a migration with a golden-set re-run, never a silent upgrade.

### `packages/ingest/src/adapters/arcgis-dallas.ts`  — **first slice**

Point-queries the two authoritative district layers: City of Dallas council district and DISD trustee district. Requirement #4, second half. Verified end to end (1500 Marilla St → Council 7, and the DISD trustee district from PLAN_5).

- **Endpoint.** services2.arcgis.com/rwnOSbfKSwyTBcwN/…/CouncilAreas/FeatureServer/0 and services.arcgis.com/RfrtTbYxQ8YIhjWT/…/DISD_Trustee_SMD_Adopted_Dec_16_2021/FeatureServer/0
- **Change detection.** Monthly schema assertion (COUNCIL/DISTRICT present on the city layer, PLAN_5 on DISD) plus a 20-address golden-set regression. Two traps encoded as failing tests: use CouncilAreas, not CouncilDistrictBorder (a line layer whose point queries return zero features — a silent wrong answer); and never DISD's other published service TrusteeDistricts, whose layer is the 2011 Plan 12 and returns all-zero Population.

### `packages/ingest/src/adapters/fec.ts`

Federal candidate filings for TX and federal external ids. 2028 only; contributes nothing to the pilot.

- **Endpoint.** https://api.open.fec.gov/v1/candidates?election_year=2028&state=TX with a personal key, plus bulk cn{YY}.zip for closed cycles.
- **Change detection.** load_date high-water mark per run; bulk file Last-Modified/size for the cycle file. Must refuse to run with DEMO_KEY — the observed penalty is retry-after ~18 hours. Must use election_year=, never cycle=: the wrong filter returns a silently empty 2028 roster, which is the exact failure class this system cannot survive.

### `packages/ingest/src/adapters/congress-legislators.ts`

Sitting members of Congress → Incumbency rows and the federal identity crosswalk (bioguide, govtrack, wikidata, fec, ballotpedia, opensecrets, votesmart, icpsr). Members only; it will never contain a candidate.

- **Endpoint.** https://unitedstates.github.io/congress-legislators/legislators-current.yaml (CC0)
- **Change detection.** ETag and Last-Modified are both served; conditional GET is free. Note the upstream README's own caveat that the current/historical split lags when a legislator leaves office, so treat the current file as approximately, not exactly, live.

### `packages/ingest/src/adapters/openstates.ts`

Texas legislators, districts, bills and votes → Incumbency + VoteRecord. Phase 5/6. Zero candidate coverage and zero Dallas council coverage; its single Dallas municipal record is the mayor, with a stale end_date created by the holdover.

- **Endpoint.** https://raw.githubusercontent.com/openstates/people/main/data/tx/ (keyless, CC0) for people; api.openstates.org v3 with a key for bills and votes. api.openstates.org bare is NXDOMAIN — do not probe it as a health check.
- **Change detection.** One GitHub tree/contents call per directory per run, comparing commit sha. Unauthenticated GitHub is 60 requests/hour, so per-file polling will lock you out mid-run.

### `packages/ingest/src/adapters/ballotpedia.ts`

Cross-check only, and only if a contract is ever signed. Writes RosterObservation rows used solely to raise a discrepancy against the City Secretary and DISD rosters, and populates person/office/district ids into CandidateExternalId. Never writes a Candidacy and never produces a row readable from /v1 — the licence explicitly conveys no right to use or share full data sets.

- **Endpoint.** https://api4.ballotpedia.org/data/elections_by_state (403 without a contract). Rate limits are documented at 5 rps / burst 100 / 200k daily.
- **Change detection.** n/a — pull-on-demand cross-check, not a watch target. Do not build anything on candidate_lists_complete: it is undocumented and carried on rows keyed only by state and date, so it can say nothing about District 7.

---

## Schema changes

1. `model IngestRun` — id, adapter, electionId?, startedAt, finishedAt?, status (OK | NOT_MODIFIED | FAILED | QUARANTINED), fetchCount, changedCount, error?. Mirrors the existing ExtractRun. Without it, a Railway cron that never fired is completely invisible, and Railway documents no cron retry.

2. `model WatchTarget` — id, adapter, url, etag?, lastModified?, lastFetchedAt, lastChangedAt?, normalizedHash?, consecutiveFailures Int @default(0), expectedMarker String (a phrase that must appear in the body before parsing), knownSoftNotFoundHashes String[]. Conditional-GET state and soft-404 fingerprints belong in the database, not in adapter code, because they are per-host facts that change without a deploy.

3. `model RosterSnapshot` — id, raceId, ingestRunId, adapter, observedAt, candidateCount Int, payload Json (the parsed roster exactly as fetched), sourceUrl, sourceHash. Every run writes one, including unchanged runs. This is the only thing that makes a shrink detectable, and it is the provenance layer the roadmap's §4 already asks for.

4. `model RosterDiff` — id, raceId, fromSnapshotId, toSnapshotId, added String[], removed String[], changed Json, verdict enum (AUTO_APPLIED | QUARANTINED | ACCEPTED | REJECTED), reviewTaskId?, decidedBy?, decidedAt?. Enforce in code and in a contract test: a diff with a non-empty `removed` can never be AUTO_APPLIED.

5. `model CandidateExternalId` — id, candidateId, system enum (FEC | BIOGUIDE | OPENSTATES | BALLOTPEDIA | WIKIDATA | DALLAS_FILING | DISD_FILING), value, sourceUrl, observedAt, @@unique([system, value]). Replaces the untyped `Candidate.externalIds Json`, which cannot stop two candidates from claiming the same FEC id — precisely the failure that 16 duplicate-id names in TX 2026 will produce.

6. `Election` additions — filingOpensAt, filingDeadline, withdrawalDeadline, writeInFilingDeadline, writeInWithdrawalDeadline, ballotOrderDrawnAt?, certifiedAt?, rosterFrozenAt?, datesDerivedFrom String (the statute citations), parentElectionId? (a runoff points at its general). The calendar must carry its own citation so a wrong date is traceable to a wrong reading, not to a wrong scrape.

7. `Race` additions — seatsToElect Int @default(1); rosterStatus enum (UNKNOWN | FILING_OPEN | FILING_CLOSED | CERTIFIED | CANCELLED_UNOPPOSED | FROZEN); cancelledReason String?; expectedCandidateCount Int? set from the certified ballot. Publication of a race refuses when Candidacy count ≠ expectedCandidateCount. DISD's Order of Cancellation for an unopposed seat is a real state the current schema cannot represent.

8. `Candidacy` additions — filedAt?, certifiedAt?, withdrawnAt?, withdrawalSourceUrl?, isWriteIn Boolean @default(false), isPlaceholder Boolean @default(false), firstObservedAt, lastObservedAt, observedSourceUrl, snapshotId. The placeholder flag exists because 2025 BallotOrder.pdf printed a bare "Write-In Candidate" line with no name in four districts; that must become a row that blocks race publication, not an absence nobody notices.

9. `enum CandidacyStatus` — add DISQUALIFIED, REINSTATED, CANCELLED_UNOPPOSED to the existing DECLARED/QUALIFIED/WITHDRAWN/WON/LOST/RUNOFF. Enforce that WITHDRAWN requires a non-null withdrawalSourceUrl, so a candidate can only disappear with a document behind them.

10. `model SeatUpForElection` — id, officeId, electionId, isUp Boolean, authority String ("Dallas City Council Resolution 25-1776, Nov 12 2025"), authorityUrl, enteredBy, enteredAt, verifiedAt. November 2027 is a transition election with holdover seats; which seats are up is set by resolution and derivable from no source. It gets a row with a citation and a human's name, and it is the denominator every completeness check runs against.

11. `Candidate` name handling — add normalizedName String (indexed) and nameVariants Json[] carrying {value, sourceUrl, observedAt}. fullName stays the certified-ballot spelling. This is what survives Sukhbri/Sukhbir Kaur, Russouw/Rossouw and Brian/O'Neil Hesson without silently overwriting the certified name with the filing name.

---

## Scheduling

Railway cron on a dedicated `ingest` service, all times UTC (Railway crons are UTC; the filing deadline is a Texas date, so store the offset explicitly and never let a cron boundary decide a legal one).

`ingest:watch` — `15 11 * * *` daily, becoming `15 11,23 * * *` from 2027-07-10 to 2027-08-30. Conditional GET on every WatchTarget (City Secretary directory, DISD index and candidates page, SOS calendar, ArcGIS layer metadata). Writes fetch state only; mutates no roster. Almost every run is a 304 and costs nothing.

`ingest:roster` — `45 11 * * *` (and `45 23 * * *` in the window). Runs only for targets whose watch reported a real change. Parses, writes a RosterSnapshot, computes a RosterDiff. An all-additive diff below the auto-apply threshold writes Candidacy rows; anything else stops and opens a ReviewTask.

`ingest:certify` — `0 12 * * *` from 2027-08-16 through election day. Re-fetches BallotOrder.pdf unconditionally (ignoring 304) and re-runs the filed-vs-certified diff. This is the only detector for a post-certification court reinstatement, so it must not be allowed to skip on a cache header.

`ingest:calendar` — `0 12 * * 1` weekly. Regenerates the statutory calendar and diffs it against Election rows and the SOS page.

`ingest:federal` — `0 8 * * *`, enabled from Dec 2027 only, personal FEC key required; the adapter refuses to start with DEMO_KEY.

`ingest:heartbeat` — `0 * * * *`. Asserts every scheduled job has an IngestRun with a finishedAt inside its expected window. This exists because Railway documents no cron retry: a job that never fires produces no error, no log line and no alert, and during the filing window a silently skipped day is a candidate you never saw.

On failure: jobs are idempotent and re-runnable by hand (`pnpm ingest roster --adapter dallas-city-secretary --election 2027-11-dallas`). Each takes a Postgres advisory lock keyed on adapter+election and exits 0 if it cannot get it, so an overlapping run is a no-op rather than a double-write. A failed fetch increments WatchTarget.consecutiveFailures; at 3 the target stops being polled and opens a ReviewTask — the point being that a dead host must never read as "unchanged." No job writes to a race whose rosterStatus is FROZEN; post-freeze changes go through supersede and the public changelog, as the roadmap already requires for positions.

---

## Failure modes

These are the reason the architecture looks paranoid. Every one was observed in real
data during the probe, not imagined.

### Roster silently SHRINKS. The single unrecoverable error: District 7 had five candidates yesterday and has four today, and the missing one is simply absent from the page.

**Detect.** Every run writes a RosterSnapshot with candidateCount per race, unconditionally. The diff job compares against the last ACCEPTED snapshot. Any non-empty `removed` set is a hard stop — not a warning, not a threshold, not a percentage. Additionally: a run that parses successfully but yields fewer candidates than expectedCandidateCount for a CERTIFIED race is treated as a failed fetch, not as data.

**Respond.** Quarantine. The diff is written with verdict QUARANTINED, no Candidacy row is touched, the previous roster stays live and published, and a ReviewTask opens. A removal is only ACCEPTED when a human attaches the artifact that justifies it — a Certificate of Withdrawal PDF, an Order of Cancellation, or a certified ballot that omits the name — recorded in withdrawalSourceUrl. There is no code path that removes a candidate without a document.

### Silently empty roster from a query-shape or discovery bug. FEC `cycle=` instead of `election_year=` returns an empty 2028 set with HTTP 200. The DISD slug rotates and the fetch 200s on last cycle's page. The /pdf/Elections/2027/ folder does not exist yet and the listing parse yields nothing.

**Detect.** Zero-row and near-zero-row guards on every adapter: a race that previously had N>0 candidates returning 0 is a fetch failure, never a roster update. Per-adapter fixture tests assert a known non-empty parse against a checked-in snapshot. The DISD adapter asserts the discovered slug's election date matches the Election row before parsing a single name.

**Respond.** The run fails loudly with a non-zero exit, the IngestRun records FAILED, and the heartbeat job surfaces it. Nothing is written. A missing year folder sets rosterStatus UNKNOWN and reports "not yet published," which is a materially different state from "no candidates."

### Soft-404 and wrong-page 200. sos.state.tx.us returns HTTP 403 as its not-found response at a reproducible 20,695 bytes; the DISD page titles itself with the wrong year; an ASPX page redirects to a default landing page containing zero occurrences of "candidate."

**Detect.** Every WatchTarget carries an expectedMarker that must appear in the body before any parsing runs, plus a list of known soft-404 body hashes. Status code alone is never sufficient evidence that a page is the page.

**Respond.** Marker absent → treated as a failed fetch, consecutiveFailures increments, nothing parsed. A body matching a known soft-404 fingerprint is logged as NOT_FOUND rather than FAILED so the distinction stays visible in the run history.

### Rotating-token false positives. The City Secretary's ASPX pages echo serverTime at sub-second precision plus per-request __VIEWSTATE and __REQUESTDIGEST; dallasisd.org carries a per-request Cloudflare __CF$cv$params token at identical byte count. Naive content hashing alarms on every single poll, and an adapter that cries wolf daily gets muted, which is how you miss the one real change.

**Detect.** Normalize before hashing (strip the named token patterns), and prefer HTTP 304 — verified working on both citysecretary2.dallascityhall.com and the SOS host — over content hashing. Assert the inverse as a bug: raw hash changed while normalized text is identical means the normalizer is missing a token, and that opens an engineering task, not a data alert.

**Respond.** Fix the normalizer. Never suppress the alert by raising a threshold.

### Filed ≠ certified. In 2025, the APPS/ folder (60 files) and BallotOrder.pdf disagreed in both directions: four people filed but did not appear on the ballot, several names drifted in spelling between the two, and four districts printed a bare "Write-In Candidate" line with no name at all.

**Detect.** The filed-vs-certified diff is its own scheduled job with its own output, not a side effect of parsing. Every certified-name-with-no-matching-filing and every filing-with-no-certified-entry opens a ReviewTask. Fuzzy name matching proposes pairs; it never confirms them.

**Respond.** isCertified is set only from BallotOrder.pdf. A filed-only person is displayed as filed, never as on the ballot. A nameless write-in line becomes an isPlaceholder Candidacy that blocks publication of that race until a human supplies the name — an unnamed candidate on the ballot is a missing candidate, and the product must refuse to render a race as complete while one exists.

### Court reinstatement or disqualification reversal after certification. No feed exists for this at any level, from any source examined.

**Detect.** ingest:certify re-fetches BallotOrder.pdf unconditionally every day from the filing deadline through election day, ignoring cache headers. Any change to a certified ballot after certifiedAt is a page-one alert, not a routine diff.

**Respond.** Human adjudication with the court or city document attached; the candidacy moves to REINSTATED or DISQUALIFIED with the artifact recorded. Honest residue: the automated signal is the ballot changing, which may lag the ruling by days. A standing human watch on local reporting is the only earlier signal, and it should be named as a pilot duty rather than assumed.

### Runoff. Dallas municipal races require a majority; a race with no >50% winner produces a December runoff with a two-name roster, and the pilot will almost certainly have several.

**Detect.** Results ingest is out of scope, so the detector is the City Secretary posting a runoff order into the same directory tree the adapter already watches — plus the statutory runoff date the calendar generator can compute in advance.

**Respond.** A runoff is a new Election with parentElectionId pointing at the general, new Races and new Candidacies. Never an edit of the general's rows. The general's results stay exactly as published, consistent with the append-only rule that governs Position.

### Source silently changes shape. The IIS listing becomes JS-rendered; the ArcGIS layer is superseded (DISD already publishes a second, disagreeing trustee layer); a page moves from HTML to a PDF-only publication.

**Detect.** Per-adapter schema assertions run every time: COUNCIL/DISTRICT present on CouncilAreas, PLAN_5 on the DISD layer, expected column set on the directory listing. Parse failures are loud and never fall back to a partial result. A monthly 20-address golden-set regression catches a boundary layer that starts returning different districts for the same points.

**Respond.** Adapter is disabled, the affected races fall back to the manual CSV roster of record (which is still correct and still published), and an engineering task opens. Falling back to a stale-but-reviewed roster is always better than publishing a partial fresh one.

### TLS chain break under Node. dallascityhall.com serves a depth-0 leaf with no intermediate. curl passes on its own bundle; Node's undici throws UNABLE_TO_VERIFY_LEAF_SIGNATURE. A curl-based smoke test will report the host healthy while the production fetch fails.

**Detect.** CI smoke test fetches every adapter base URL through undici — the same client production uses — never through curl.

**Respond.** Pin the issuer intermediate via NODE_EXTRA_CA_CERTS. Never disable certificate verification, and never set rejectUnauthorized:false: this is a pipeline whose entire value is that the archived source is what the source actually said.

### Rate-limit lockout mid-run. FEC DEMO_KEY returned retry-after ~64,520 seconds (~18 h) after roughly ten calls; unauthenticated GitHub is 60 requests/hour.

**Detect.** 429 and 403-with-rate-limit-body are classified distinctly from other failures in IngestRun.status, and remaining-quota headers are logged per run.

**Respond.** The FEC adapter refuses to start with DEMO_KEY. GitHub-backed adapters make one tree call per directory, not one call per file. On a 429, back off for the full advertised retry-after rather than retrying — a retry storm converts a one-run outage into a day-long one.

---

## Do not build

1. Do not scrape a city, county or district page without an adapter and a fixture test — CLAUDE.md already forbids it, and this is why: the failure is silent. A 200 on the wrong page, a rotated slug, or a not-yet-created year folder all produce an empty parse, and an empty parse that reaches the database is a missing candidate, which is the one error this product cannot recover from. Ad-hoc scraping fails open; an adapter with a marker assertion and a snapshot test fails closed.

2. Do not ask a model to assemble, complete, or reconcile a candidate roster. A model will produce plausible names for a District 7 field it has never seen, and plausible is indistinguishable from correct until someone votes. Roster rows come from a fetched artifact or from a human who read one. Enforce it the way the vendor-SDK rule is enforced: a test asserting packages/ingest never imports packages/extract, and a check that no Candidacy row can be written with extractedBy set to a model. Models are for Position, which is reviewed and quote-gated; they are not for existence claims.

3. Do not buy a voter file — L2, Aristotle, TargetSmart, i360. They hold voters, not candidates: wrong table entirely. It is four figures minimum, and a Texas voter file is exactly the PII this product has deliberately designed itself never to hold (no accounts, no stored addresses, geocode-then-discard). Buying one would create a privacy surface to solve a problem it does not solve.

4. Do not buy Democracy Works believing it routes around Ballotpedia's licence. Their own documentation states twice that ballot data is sourced from Ballotpedia. It is one upstream dataset behind two sales processes, and the re-serving restriction travels with it. If a commercial roster is ever worth buying, buy the upstream and buy it for person.id and district-granular rosters — not for candidate_lists_complete, which is undocumented and keyed only by state and date.

5. Do not make Google Civic a dependency. The elections and divisions resources survive and divisionsByAddress works, but voterInfoQuery returns a ballot roughly two to three weeks out — uselessly late for building issue coverage, which needs the roster in August so extraction and review can run before the freeze. Off-cycle municipal coverage is unverified, the API has already survived one turndown, and Census + ArcGIS solve address→district for free with layers we can assert against.

6. Do not spend engineering time on Dallas County as a roster cross-check. The Candidates page is filing and campaign-finance guidance containing no names — it explicitly tells council candidates to file with the City Secretary and ISD candidates with their own district — and wp-json returns 401 from a Disable REST API plugin, not a bot challenge you can negotiate past. There is nothing behind the wall.

7. Do not build a VIP feed ingester. data.votinginfoproject.org does not resolve, the specification has been frozen at v6.0-release since January 2022, and the repo carries NOASSERTION licensing. It is a schema, not a source, and no one is publishing Dallas data into it.

8. Do not build a PostGIS shapefile pipeline for district boundaries. Two keyless ArcGIS point queries already return the right answer and are verified end to end; the GIS stack is weeks of work to re-solve a solved problem. Spend that time instead on the one real open question — getting DISD to state in writing which of its two disagreeing trustee layers is authoritative for November 2027.

9. Do not budget engineering effort against Texas SOS or Dallas County "bot hostility." The SOS 403s are that host's ordinary not-found response — a deliberately nonexistent path returns the same 403 at the same byte count — and there is no evidence of user-agent filtering. Build marker assertions, not evasion.

10. Do not use content hashing as the primary change-detection mechanism on these hosts, and do not raise a threshold to quiet it. Conditional GET works on both the City Secretary and the SOS; where hashing is needed, normalize the per-request tokens first. An adapter that alarms every day teaches its operator to ignore it, and the one day it is right will be the day someone withdraws.

---

## First slice

Ship `packages/ingest/src/adapters/dallas-isd.ts` plus the RosterSnapshot/RosterDiff tables and the shrink guard, running nightly on Railway against the live Dallas ISD elections index — and populate the DISD trustee races end to end from it.

Why this and not the City Secretary: DISD is half the pilot's contests (5 of ~20), it is free, keyless, needs no contract and no PDF OCR, and — critically — the live page family already contains, today, every hard case the November 2027 roster will throw: an index whose per-election slug rotates each cycle, a <title> naming the wrong year, candidates added incrementally as they file, a linked Certificate of Withdrawal, and an Order of Cancellation for an unopposed district. The City Secretary adapter is the harder and more valuable one, but its 2027 folder does not exist yet and its hardest problem (filed-vs-certified reconciliation across scanned PDFs) cannot be exercised against live data for another eleven months.

What it proves, concretely:
1. Discovery-from-index survives slug rotation — the thing that would silently break the pipeline in August 2027 and hand you an empty roster.
2. Change detection is stable: with the Cloudflare `__CF$cv$params` token stripped, an unchanged page produces an unchanged normalized hash across many polls; unstripped, it changes every time. This one test tells you whether the whole watch layer is trustworthy.
3. The shrink guard actually fires on real data. Replay the snapshot sequence across a withdrawal and a cancellation and assert that both quarantine rather than auto-apply, and that the previous roster stays published until a human attaches the artifact. This is the one behavior the product cannot get wrong, and it should be proven against a real Certificate of Withdrawal, not a fabricated fixture.
4. The seat-roster provenance path exists: SeatUpForElection rows entered by hand with a resolution citation, and a completeness check that runs against them rather than against whatever the page happened to return.
5. Nothing in the ingest path can invent a name — enforced by the test that packages/ingest cannot import packages/extract.

Sequence after it, in order: `tx-uniform-dates.ts` (1–2 days, unblocks the whole 2027 calendar with no network dependency at all), then `census-geocoder.ts` + `arcgis-dallas.ts` (2 days, closes requirement #4 completely), then `dallas-city-secretary.ts` (5–7 days, the pilot's other 15 contests) with the TLS intermediate pinned and a CI smoke test that fetches through undici rather than curl. Manual residue for the pilot, sized honestly: about 38 hours of human reading between June and November 2027 — 7 h on the seat roster and its quarterly re-verification, 15 h reconciling the filing window (a full baseline pass and a full deadline pass at ~4 h each, plus fourteen 30-minute triage sessions), 2 h across the withdrawal and write-in window, 4 h on the ballot-order certification diff, 7.5 h of weekly standing triage, and 3 h for the December runoff roster — of which roughly 20 hours land in the three weeks around August 16–23, 2027. Staff that window before it arrives.

---

## Corrections to this plan, verified afterwards

The plan above was written from the probes. Two of its claims were checked directly and
one is wrong.

**The DISD trustee layer question is settled — it does not need a letter from DISD.**
The plan lists "get DISD to state in writing which of its two disagreeing trustee layers
is authoritative" as an open item. The service metadata already answers it:

| Service | Underlying layer name | Verdict |
|---|---|---|
| `DISD_Trustee_SMD_Adopted_Dec_16_2021` | `DISD_Trustee_SMD_Adopted_Dec_16_2021` | **Authoritative.** The adopted plan |
| `Trustee_Boundaries` | `DISD_SMD_Adopted_Dec_16_2021` | Same plan. Agrees on **183 of 183** sampled points |
| `TrusteeDistricts` | `Dallas_ISD___Plan_12_Adopted_Aug_25_2011___BHDA` | **Superseded 2011 map. Never use.** |

Measured against the adopted plan, the 2011 layer puts **14 of 183 sampled points in the
wrong trustee race**. The danger is the ratio: at ~92% agreement it passes every casual
spot-check, and the service carrying it has the most inviting name of the three. Both
pinned identities are asserted in `districts.live.test.ts`, and the stale layer is named
in `STALE_LAYERS` so it stays greppable.

The city side has the same shape: an ArcGIS Online mirror named
`City_of_Dallas_Council_Districts` carries 2011 boundaries, while the on-prem
`Basemap/CouncilAreas` is current and additionally returns the sitting member's name.

**Still genuinely open, and it is not a GIS question:** which of the 15 council seats and
which 5 of 9 DISD trustee seats are actually up in November 2027. That is set by council
resolution 25-1776 and its DISD counterpart, is derivable from no machine-readable
source, and is the denominator every roster-completeness check runs against. It gets a
`SeatUpForElection` row with a citation and a human's name on it.
