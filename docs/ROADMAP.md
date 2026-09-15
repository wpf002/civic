# Civic — Roadmap

**Goal.** Any voter in the United States looks up their address and sees every election they can
vote in — city, state and federal — and where each candidate stands on the issues, in the
candidate's own words with a link to the source.

**The product is the Position table.** `candidate × proposition` with a stance, a plain summary, a
verbatim quote and a source URL. Everything a user sees is a view over it. If that table is accurate
and covered, the app works. If it isn't, nothing else matters.

**Nonpartisan by mechanism.** Positions are answers to a fixed neutral question, quotes are verbatim
spans of an archived document, and absence is shown as absence. The system cannot express an opinion
because there is nowhere for one to go.

Last revised 2026-09-15.

---

## Version 1 — the November 3 2026 general election, every state  ← current

Texas early voting starts October 19, so Version 1 is due October 16. Phases below are lettered
to keep them apart from the numbered history that follows.

| Phase | Work | Done when | Status |
|---|---|---|---|
| **A. Finish Phase 5** | Audit stated positions and absences; clear the review queue; correct what the audit found | The live error rate is measured for both kinds of claim | **Met.** See Phase 5 |
| **B. Every federal race** | 436 House seats and 35 Senate races in all 50 states and DC; House districts from the maps in force | Any US address shows its correct House and Senate candidates | Races, districts and FEC filers done. Certified candidates in 6 states. **The other 45 need ballot data** |
| **C. Governor and statewide** | 36 governor races and statewide officers | Every state loaded, or marked not covered with the reason | 6 states loaded from their certified lists |
| **D. Positions nationwide** | Sites, crawl, extract, verify, publish, one state at a time | Every federal and governor candidate with a website has been read | Not started. Each state's cost is quoted exactly before it runs |
| ~~E. Questionnaires~~ | | | **Dropped** 2026-09-15. Campaigns would not answer an unknown sender |
| **F. Legislature and local** | Where a state's own list includes them | Candidate lists loaded; positions per state on approval | Legislatures loaded for TX, NC, MN, CO, ME |

**House districts are not the Census layer's.** Ten states drew new congressional maps for 2026
after the layer the Census geocoder serves. For TX, NC, CA, FL and LA the district comes from the
enacted plan's block assignment file; for OH, UT and TN from the boundaries the state's GIS office
publishes. Alabama's plan is published only as a PDF, so an Alabama address is told its House
district is unknown instead of being shown the old one. Missouri enacted a map, a court barred it
on September 3 2026, and the Secretary of State has since directed counties to the 2022 map, which
is the Census layer. Every plan's status is rechecked before the election.

**Ballot data for the other 45 states** comes from Google's Civic Information API, which relays
what state and local election officials supply. The reader is built: one public library address
per House district, placed by the plan in force (429 of 436 districts have one). It needs a
`GOOGLE_CIVIC_API_KEY`. A state with no data there needs its own certified list.

## Where things actually stand

| | |
|---|---|
| Elections with races | 51 — every state and DC, November 3 2026 |
| Races | 1,352 — 507 federal and governor, 845 statewide and legislative |
| Candidates on file | 4,255, of whom 1,878 are certified to a ballot (TX 469, MN 427, NC 366, ME 352, CO 246, SD 18) |
| District plans in force | 9 states registered |
| **Published positions** | **2,556 — 56 stated, 2,500 "no stated position"** |
| Stated-position error rate | 5 wrong of 43–45 real rows audited, about 11%. All 5 corrected |
| Absence error rate | 1 wrong of 57 audited, 1.8%; 95% range 0.3%–9.3% |
| Admin access | reviewer accounts, scrypt + server-side sessions |

## The shape of the problem

Three layers, and they are not equally hard. Every phase below is organised around this.

**Federal.** Solved. The FEC covers all 50 states for who filed; state certified lists say who is
actually on the ballot.

**State.** Per-state work. No national source exists — Google Civic is retired, Ballotpedia's API is
paid, the Voting Information Project needs a partner relationship. Roughly 6 states publish a clean
bulk file; another 15–20 publish something parseable; some publish nothing.

**Municipal.** ~19,000 municipalities and ~13,000 school districts. **Do not model this as 32,000
adapters.** Some states publish local candidates in the same file as everything else — North Carolina
lists town mayors and county sheriffs in one CSV. Where the state does it, one adapter buys the whole
state. Where it doesn't, it is city-by-city and only worth it for a specific pilot.

**Coverage ceiling is a per-state fact, not a bug.** NC, MN and ME include county offices; CO, CA and
FL stop at state level because county filings stay with county clerks. Store the ceiling with the
rows, or a missing sheriff's race looks like a data error.

---

## Phase 1 — Make one election real, end to end

Texas, November 3 2026. Federal races only. The point is to publish something true, not something big.

- [x] Certified ballot from the Texas SOS (98 candidates, 39 races)
- [x] Candidate websites from FEC Form 1, Congress.gov, OpenStates
- [x] Archive websites as quotable sources
- [x] Two-model extraction with a verbatim-quote gate
- [x] Adversarial verification that rejects slogans, accomplishments and wrong directions
- [x] Propositions — one neutral yes/no question per issue
- [x] Re-extract against propositions and measure the support/oppose ratio
- [x] Crawl `/issues`, `/platform`, `/priorities` rather than the homepage alone
- [x] Render JavaScript-only sites. A Playwright fallback, used only when a plain fetch returns an
      app shell — 17 pages recovered that would otherwise have read as candidates who said nothing.
- [x] Publish the surviving positions
- [x] The web app shows a real Texas race with real quotes

**Done when:** a voter in a Texas congressional district can see every certified candidate, each
candidate's answer to each proposition or an honest "no stated position", and click through to the
archived source for every quote.

**Kill criterion:** if after crawling policy pages fewer than 30% of certified candidates have at
least one verified position, the campaign-website source is not sufficient on its own and Phase 2
becomes mandatory rather than optional.

---

## Phase 2 — Thicken what a position can come from

Campaign homepages are mostly biography. Measured yield on Texas was 17% of candidate-by-issue pairs
before verification, and 34 of 98 candidates said anything at all. Ranked by how directly the
candidate is speaking:

- [x] **Roll-call votes for incumbents.** Built, measured, and it yields almost nothing. 3,936
      votes across 164 bills for 25 sitting members. Of 95 bills with an official summary, the
      classifier proposed 3 mappings to a proposition and an adversarial second pass refuted all 3
      — a DOJ reporting requirement about cashless-bail jurisdictions, a duty-free extension for
      Haitian apparel, and a non-binding resolution praising past tax relief. None was a vote on the
      change its proposition describes.

      **This is a finding, not a failure.** A vote is the strongest evidence available in
      principle, and in practice congressional roll calls are overwhelmingly procedural, narrow, or
      commemorative. The apparatus is built and correct; a wider window of votes, or votes on a
      cycle with more floor activity on these questions, may yield more. Do not plan coverage
      around it.
- [x] **Candidate questionnaires.** Neither source is programmatically available: Vote411's ballot
      tool is a client-side app with obfuscated keys and no public API, and Vote Smart's documented
      endpoints return 404 (both checked Sept 2026). Scraping Vote411 would also mean taking the
      League's editorial work. Built as a strict CSV instead — the path CLAUDE.md already blesses —
      so answers from a partnership feed, a newspaper questionnaire or a candidate's emailed reply
      load without extraction, because the candidate answered.
- [x] **Deeper site crawling.** Policy content is usually one link off the homepage.
- [x] **Debate and forum transcripts** — same CSV path, for the same reason. A transcript quote is
      a candidate answering a question; there is no national source and no extraction step needed.

Explicitly not a source: campaign finance. Who funds a candidate is not a statement of what they
would do, and treating it as one is the kind of inference this product exists to avoid.

**Done when:** at least half of certified candidates in a covered race have one verified position,
and incumbents have positions drawn from their votes rather than their marketing.

**NOT MET, and not reachable from these sources.** Measured 2026-09-08, Texas November 2026:

| | |
|---|---|
| Certified candidates | 98 |
| With no campaign website at all | **37** |
| Of those, holding only a state id and no FEC committee | 25 |
| Ceiling on website-only coverage | **62%** |
| Races where half of certified candidates could ever be covered | far fewer — several have 2 archived of 5 |

Both halves of the criterion fail for structural reasons rather than for want of effort.

The vote half fails because congressional roll calls do not answer these questions — 3,936 votes,
164 bills, zero confirmed mappings. Recorded above.

The website half fails because 37 of 98 certified candidates have no website to read. 25 of those
never filed an FEC committee, which is where a campaign's own website address comes from, so there
is no record of a site to find. The remaining route is a search engine, and "the top hit for this
name" is how one candidate's words get attributed to another — the one error this product must not
make. Deriving a domain from the personal email in the state file is also available and also
refused: that address is dropped at the parse boundary on purpose.

**Routes tried after that measurement, with results:**

| Route | Outcome |
|---|---|
| Domain guess, then prove the page names the candidate and the office | **17 recovered**, 92 domains refused. Certified coverage 61 → 78 of 98. |
| Wikidata `P856` | 2 usable of 37, plus a false positive: a Syracuse architecture professor also named Ted Brown |
| State party nominee lists | LP Texas publishes no links, TX Greens none, TX GOP 403, TX Democrats 404 |
| GDELT news index | Free and keyless, but returns zero articles for sitting members of Congress and intermittently fails to parse. Not usable. |
| Search API | No key available. Would need one, with the same proof requirement the domain guess uses. |

The remaining gap is concentrated and the party fix showed where: 19 of 78 major-party candidates
have no website, against 18 of 20 Green, Libertarian, independent and unrecorded ones. Excluding
minor-party candidates would meet the number and tilt the guide, so it stays as measured.

**What would meet it:** real questionnaire data. The loader is built and strict, and a questionnaire
answer needs no website. It needs a partnership or a person entering answers from a lawful source,
which is a decision about the product rather than a piece of code.

Leaving this open rather than lowering the number. A criterion moved to match the result measures
nothing.

---

## Phase 3 — Address to ballot

A user types an address and gets their races. Without this the data is not reachable by a voter.

- [x] Census geocoder → state, county, congressional district, state legislative districts
- [x] OCD division IDs — the Open Civic Data list: 36,138 municipalities, 17,235 school districts,
      3,057 counties. Public domain, one CSV, no key. It is the SPINE, not coverage: a jurisdiction
      imported from it has no races until an adapter finds some, and the ballot endpoint reports it
      as not covered.
- [x] Wire the existing district resolver to the home page
- [x] Show the coverage ceiling honestly: "we have your congressional race; we do not yet have your
      city council race"

**Done when:** an address in a covered state returns the correct set of races, and an address in an
uncovered one says so plainly instead of returning nothing.

---

## Phase 4 — More states, in the order they are actually available

Six states publish a clean bulk file today. Each is one adapter with a fixture test.

- [x] Texas — certified ballot, federal + state + county, no municipal
- [x] North Carolina — filings, includes municipal and county
- [x] Minnesota — state + federal file and a separate local file. Latin-1, not UTF-8.
- [x] Maine — full county row officers
- [x] Colorado — state and judicial only; ceiling recorded on the run
- [ ] ~~Virginia~~ — checked, and it publishes only a single House District 20 special
      election file for November 2026, not a statewide list. The research that named it
      overstated what is there. Revisit for a cycle where it publishes the full list.

Then the second tier: Florida, South Dakota, Alaska. Michigan publishes no statewide list at all and
points to 83 counties — do not schedule it.

Two rules learned the hard way:
- **Scrape the index page for the current file URL.** Several states embed a revision date in the
  filename.
- **A per-state adapter, not a vendor integration.** Texas's endpoint looked like a vendor pattern
  that would generalise. It does not; Texas is a one-off.

**Done when:** 6 states have adapters with fixture tests, and each records its own coverage ceiling.

Five done: TX (certified, federal+state+county), NC (filings, includes municipal), MN (state and
local files), ME (county row officers), CO (state and judicial only). Maine and Colorado publish
spreadsheets and nothing else, read by a minimal xlsx reader in `packages/ingest/src/xlsx.ts`
rather than a dependency.

---

## Phase 5 — Review at scale

Every position is DRAFT until a person publishes it. That is the bottleneck, and it does not scale by
adding people.

- [x] Adversarial verifier that rejects positions a quote does not support
- [x] Review console shows verified drafts grouped by race, not one at a time
- [x] Spot-check sampling: a reviewer reads a deterministic sample and publishes the race if it
      holds up. Deterministic on purpose — a reshuffling sample lets a reviewer redraw until a
      batch looks good.
- [x] Real authentication. Reviewer accounts with scrypt password hashes and server-side sessions,
      replacing the shared secret. A verified session always beats the x-reviewer header, so the
      audit trail on a published claim cannot be forged by the one caller we can identify.

**Done when:** publishing a race's positions takes minutes, and the error rate of published positions
is measured rather than assumed.

**Met 2026-09-15.** Every live stated position was audited (59, of which 14 are the synthetic Dallas
fixture and excluded) and a seeded sample of 60 absences, each read against every page archived for
the candidate. Stated: 5 wrong among the real rows, all corrected by superseding rows. Absences: 1
missed position in 57. 5 of 119 calls failed and are left out of both rates rather than counted as
errors. Cost 89.55c.

---

## Phase 6 — The voter-facing product

- [x] Issue-first browse: pick a proposition, see every candidate's answer side by side
- [x] Candidate page: every proposition, answered or honestly blank
- [x] Match quiz — now asks the propositions themselves, so a voter answers the same sentence the
      extractor did. Answers never leave the device and are never persisted.
- [x] Share card
- [x] Corrections log, public

---

## Standing rules

These are in `CLAUDE.md` and are not negotiable per-phase.

- Published positions are immutable. A correction is a new row with `supersedesId`.
- Every position needs a verbatim quote from an archived source. Model output never reaches
  `Evidence.quote`.
- `NO_STATED_POSITION` is a real answer shown to users. Never filled from party or endorsements.
- Quiz answers are never persisted.
- A roster that shrinks never auto-applies. A candidate leaves the ballot only with a document.
- Personal data in a government file — home addresses, phones, emails — is dropped at the parse
  boundary, by allow-list.
- Rewording a proposition mints a new version. Existing positions stay on the old wording and are
  re-extracted, never migrated.

---

## Open questions, with the decision each one blocks

| Question | Blocks | Status |
|---|---|---|
| Is the support/oppose skew the extractor or the candidates? | Whether propositions were sufficient | Re-extraction running |
| What is the published error rate? | Whether AI review can gate publishing | Needs Phase 5 sampling |
| Which states beyond the six are parseable? | Phase 4 ordering | 6 confirmed, ~6 unknown behind bot protection |
| Is there any national municipal source? | Whether Phase 3 can promise local races | Answer so far: no |

---

## History

`docs/ROADMAP_ORIGINAL.md` is the plan this replaced. It targeted a May 2027 Dallas municipal
election that does not exist — Proposition D in November 2024 removed the May requirement from the
Dallas charter, and the council voted 15-0 in November 2025 to move to November of odd years. The
Dallas pilot is still a good test of the municipal layer and is preserved as fixture data, but it is
no longer the lead: the November 3 2026 general is the election that is actually live.
