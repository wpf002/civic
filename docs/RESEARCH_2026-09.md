# Landscape research — September 2026

409 sources fetched across 12 angles, then audited by a critic that re-verified claims against
live sources. Everything below traces to a URL that was actually retrieved. Where the critic
corrected the sweep, the corrected number is what appears here.

Full machine-readable output, including all 289 UX findings and the per-source list, is not in
the repo; this file is the decision-relevant summary.

---

## 0. The finding that changes the plan

**The May 2027 Dallas municipal election does not exist.**

Dallas voters passed [Proposition D](https://ballotpedia.org/Dallas,_Texas,_Proposition_D,_Change_to_City_Council_Elections_Charter_Amendment_(November_2024))
in November 2024, deleting the charter requirement that council elections be held in May. In
November 2025 the council voted 15-0, with the mayor, to move to November of odd years. The next
Dallas municipal election is **November 2, 2027** — nine months later than this roadmap assumed,
and on the same ballot as the state constitutional amendment election.
([D Magazine, 2025-11-12](https://www.dmagazine.com/micropost/dallass-next-election-will-be-november-2027/))

DISD followed with its own resolution: trustee terms change from three years to four, **five
trustees are up in November 2027 and four in November 2029**, with some sitting terms cut or
extended and the assignment settled by agreement or by drawing lots.
([Dallas Free Press, 2025-12-17](https://dallasfreepress.com/dallas-local-government/local-elections-move-november/))

Consequences, in order of severity:

1. Every calendar anchor in the roadmap is wrong — filing deadline, extraction window, data
   freeze, outreach schedule, and the Phase 4 date range.
2. **The electorate changes.** May 2025 city turnout was 8.4% of Dallas County's registered
   voters; West Dallas ran 6% for council and 5% for the DISD seat. A November odd-year ballot
   with statewide propositions draws a different and larger electorate.
3. **The competitive premise weakens.** "Nobody covers this race" was the reason to pick it.
   Statewide guides cover a November constitutional-amendment ballot, so Civic's races now sit
   underneath something other outlets already publish.
4. Nine extra months of runway, which is the one favorable consequence.

---

## 1. Competitors that matter

| Product | Threat | Does well | Fails at |
|---|---|---|---|
| [Dallas Morning News Voter Guide](https://www.dallasnews.com/projects/2026/dallas-may-election-voter-guide/) | **High** | Owns the pilot geography. Address→district lookup, printable ballot, incumbent badges, existing candidate relationships | Non-responders render as a bare name — "did not respond" appears zero times in the markup. Editorial-board endorsements interleaved with the neutral guide. **The May 2025 guide is gone**: pages 404, no Wayback snapshot |
| [Vote Compass](https://files.voxpoplabs.com/votecompass/methodology.pdf) (Vox Pop Labs) | **High** | The category's methodological standard. Versioned methodology, double-coding, candidate self-code portal, reconciliation report, named academic arbiters. 50 Ontario municipalities for Oct 2026 | Pipeline assumes the candidate answers; municipal deployments *delete the neutral option* to force position-taking, converting silence into a fabricated stance. Needs a newsroom per city |
| Consumer chatbots (ballot photographed into ChatGPT) | **High** | Zero switching cost, already the observed behavior, answers DISD questions today | States United measured incomplete candidate lists in **88.9%** of gubernatorial queries. No sources, no persistence, no comparison |
| [OnTheBallot.ai](https://ontheballot.ai/race/tx-sen-2026) | Medium | Structurally closest shipping analog: issue × candidate matrix, `NO MENTION` as first-class, coverage %, dated corrections log | **No quote field exists.** 2 of 11 positions have `source_url:null` at confidence "high", under a footer promising "Every stance cited". Candidates ranked by fundraising |
| [BallotReady / CivicEngine](https://developers.civicengine.com/docs/api/graphql/reference/objects/stance/index.html) | Medium | Largest down-ballot stance dataset (~600k). Production `Stance` type Civic's `Position` extends | School boards are a **paid Tier 4 add-on**. Campaign websites only — no news, forums, or social. Reserves the right to substitute words inside quotation marks. States stances "are not fact checked" |
| [iSideWith](https://www.isidewith.com/candidates/greg-abbott/policies) | Medium | 53M+ users, owns "who should I vote for" search | Greg Abbott's 429 policy rows source out as: **Party's support base 275, ChatGPT 149, Party Research 86, public statements 3, voting record 1.** No "no stated position" value exists. Zero municipal questions |
| [Meet Your Mayor](https://github.com/thecityny/2025-meet-your-mayor) (THE CITY) | Medium | Best UX in the category, MIT-licensed, forkable in weeks. Answer-then-reveal; agreement receipts; shuffle-before-sort | Data layer is pipe-delimited strings in a Google Doc validated by `console.log`. 100% dense matrix because editors **assigned Eric Adams's positions**, with no field distinguishing that from a survey answer |
| [LikelyStance.com](https://natlawreview.com/press-releases/ai-election-tool-launched-makerfield-election) | Unknown | Launched 2026-06-10. Tagline "Evidence-Based Stance Inference"; claims quote + citation + **verification against a cached source document** | Site is a JS shell returning nothing to a fetch, so the claim is unverified. This is Civic's headline differentiator, already claimed by someone else at UK constituency level |

Also live and unexamined by the sweep: **Democracy Works Elections API** (the commercial answer to
address→district, powering Perplexity's Election Hub), and **Perplexity itself** as a destination
owning the "who's on my ballot" query.

For DISD specifically, the only organizations collecting trustee positions are endorsement PACs —
[Dallas Kids First](https://www.dallaskidsfirst.org/community-endorsement-panel.html) and
[EducateDallas](https://www.educatedallas.org/endorsements). They are simultaneously the only
existing corpus for the hardest half of the pilot and the reason a "neutral" DISD guide gets read
as taking a side.

---

## 2. Experts

| Person | Org | Why they matter |
|---|---|---|
| [Clifton van der Linden](https://experts.mcmaster.ca/people/vandew3) | Vox Pop Labs / McMaster | Running the closest live analog — Vote Compass across 50 Ontario municipalities. His calendar (surveys mailed July, launch September) is the empirical answer to "when do we contact Dallas candidates" |
| [Kostas Gemenis](https://www.researchgate.net/profile/Kostas-Gemenis) | Cyprus Univ. of Technology | Published the sharpest warning that machine-coded party positions "lack validity, especially on the specific policy statements employed in VAAs" — weakest exactly at Civic's granularity. The reviewer most likely to break the extractor |
| [Tom Louwerse](https://www.tomlouwerse.nl/project/vaa/) | Leiden | Showed a *majority* of StemWijzer users would get different advice under a different distance function. Defined the test Civic can run cheaply because `match.ts` is deterministic |
| [Yamil Velez](https://polisci.columbia.edu/content/yamil-r-velez) | Columbia | Named the bias Civic inherits by design: extraction from public record "benefits candidates more vocal in the local press." The strongest fair criticism of the architecture |
| [Micha Germann](https://michagermann.github.io/) | Bath | Only randomized evidence that candidate-level matching beats party-level — the external justification for paying the per-candidate Dallas data cost |
| [Fernando Mendez](https://scholar.google.com/citations?user=kA5Nwz8AAAAJ) | Univ. of Zurich | euandi's seven ranked source types and its "no opinion excluded from calculation" rule are the two schema decisions Civic still owes |
| [Joshua Tauberer](https://joshdata.me/) | GovTrack | Retracted every single-year ideology score after one was weaponized. Has already lived the failure Civic is walking toward; read his retraction before shipping |
| [Whitney Quesenbery](https://civicdesign.org/about/our-team/whitney-quesenbery/) | Center for Civic Design | Only research-backed content spec in the space. Her finding that voters arrive asking "what's on the ballot?" is a direct warning to an issue-first product |
| [Paul Loeb](https://www.paulloeb.org/) | guides.vote | The campaign-review protocol Civic will need the first time a Dallas comms director calls: show a campaign only its own column, hard deadline, publish without them, never give veto over phrasing |
| [Keri Mitchell](https://dallasfreepress.com/about-us/) | Dallas Free Press | Runs the paid [Dallas Documenters](https://dallas-tx.documenters.org/) corps producing attributed, dated notes from council committees — the standing record nobody is mining |
| [Diego Garzia](https://unil.academia.edu/DiegoGarzia) | Lausanne | ECPR VAA research network steering committee — the gate to the academic endorsement that makes a neutrality claim credible |
| [David G. Rand](https://scholar.google.com/citations?user=C0ANojIAAAAJ) | Cornell | On chatbot voter advice reaffirming users' biases — both the positioning against ballot-photo behavior and a red-team constraint on Civic's own summaries |

---

## 3. Table stakes Civic does not have

1. **Address → district for both council and DISD.** Every serious competitor opens with an
   address field.
2. **A saveable, printable ballot artifact.** The strongest retention mechanic in US civic tech
   and the only thing that survives the walk to the polling place. Buildable without accounts.
3. **A reader-facing corrections log** keyed to addressable position IDs. `supersedesId` exists in
   the database with no public surface — the strongest thing about the data model is invisible.
4. **A dated, versioned methodology page with an explicit generative-AI policy.** Civic ships a
   two-model LLM pipeline with no published policy. Ballotpedia's bar: may use generative AI for
   research "but must verify all information gathered this way."
5. **Per-race and per-candidate coverage indicators.** Without an honesty counter a sparse grid
   reads as broken rather than as a real absence.
6. **Office explainers** — what the office does, term length, how many to vote for. Three schema
   fields. Almost no Dallas voter knows what a DISD trustee controls.
7. **Roster from the Dallas City Secretary and County Elections**, triggered the day filing
   closes, never from a model. A missing candidate is the one unrecoverable error.
8. **Spanish at parity**, in the data model before launch. See the source-scarcity note below.
9. **Non-alphabetical tie-breaking.** A council race with an Adams and a Zamora exposes this on
   day one.
10. **Issue definitions inline**, not in a tooltip. A tooltip is a tap a phone user will not make.

---

## 4. Schema gaps

| Gap | Why it matters |
|---|---|
| **One `NO_STATED_POSITION` is doing at least three jobs.** guides.vote separates Mixed / Unclear / No position found / drop-the-question. A candidate who was **asked and declined** is different data from one whose record is silent | The difference between looking rigorous and looking broken |
| **No stored source tier.** Vote Compass publishes a six-level ranked ladder; euandi records which of seven source types was used | Converts "the LLM decided" into "the policy decided, the LLM applied it" — and gives the review queue an objective tiebreak |
| **No evidence class on Position.** OnTheBallot ties High to sponsored bills and floor votes, Medium to social posts | Two-model agreement is a confidence input with nowhere to live |
| **Only the matched substring is archived, not surrounding context.** guides.vote requires "a couple of paragraphs" around every quote | A bare span proves the words exist; it does not prove they were about this |
| **`capturedAt` and `publishedAt` are conflated** | For a substring guarantee, capture time is the only date that makes the archive verifiable |
| **No timestamp field for audio/video** | Candidate forum video is where most Dallas municipal stances actually exist |
| **No issue-per-office tagging** | Without it Civic eventually asks a DISD trustee about policing — the fastest way to look unserious to a local reporter |
| **No `isCertified` on candidacies** | Rows must exist between filing and certification and be provably unreadable from `/v1` |
| **Roll-call votes are not first-class evidence** | "Voted No on agenda item 24-1839, 2024-11-13" is unfalsifiable in a way a quote never is. Only works for incumbents — over-relying on it recreates Vote Smart's asymmetry against challengers |
| **No matcher-bias regression test** | Berdoz et al. define Answer Strength Correlation; L2 measures −0.470 vs Agreement Count at +0.256. `match.ts` is deterministic, so asserting `|ASC| < 0.15` in CI is hours of work and nobody does it |
| **Shared/cached results are not data-version invalidated** | A share card computed against a since-superseded Position is a published claim the product can no longer defend |

---

## 5. Genuine white space

Each of these is open for a reason. The reason is always that it costs something nobody wants to pay.

1. **Exact-substring verification as a hard gate that rejects rather than degrades.** Open because
   it makes the grid visibly sparser than a competitor who paraphrases. BallotReady reserves the
   right to substitute words inside quotation marks; Meet Your Mayor's quote field decays into
   paraphrase behind a `console.log`; OnTheBallot has no quote field and still ships "Every stance
   cited." **Civic already does this** — it is the only claim in the set already built.
2. **`NO_STATED_POSITION` as a completed research finding** — "we searched N sources through
   <date>; they have not addressed this" — rather than a hole. Requires proving a negative: logging
   every extraction attempt including the ones that found nothing, and a per-race parity invariant.
   Pipeline discipline with no visible output, so nobody funds it.
3. **Municipal roll-call votes as structured evidence.** Unglamorous PDF ingestion with no national
   reuse. Documenters is already producing attributed coverage of these exact bodies.
4. **Forum transcripts and local press as a first-class archived source class.** BallotReady
   excludes third-party sources "to prevent arguments over source attribution and copyright." That
   is a convenience rule, not a legal necessity, and it is the single biggest reason municipal
   coverage elsewhere is empty.
5. **A durable, immutable public URL per position surviving across cycles.** DMN's May 2025 guide
   404s with no Wayback snapshot. Voter's Edge — a decade-long MapLight × LWV partnership, the
   largest local position database in the country — is gone. Nobody is paid to keep last cycle's
   data alive, which is exactly why owning it compounds.
6. **Publishing your own matcher's bias numbers.** Not one shipping VAA discloses that a majority
   of users would get a different top match under a different distance function. Frese, Hix &
   Lachat found a 2–6 point jump in vote probability from occupying rank 1 alone — the ordering is
   the intervention. The reason nobody publishes is reputational, not technical.
7. **A taxonomy grounded in a published survey of the actual city,** with a public submission
   window before freeze. Outlier Media did this for Detroit; Wahl-O-Mat convenes an under-27 panel.
   The only defensible answer to "who chose these issues?"
8. **Two-state provenance on every row** — extracted-from-public-record vs. candidate-submitted —
   with per-race parity enforced in the pipeline, not in editorial intent.

### Things that look like white space and are not

- **A 2D ideological map.** Needs pilot survey data Civic will not have. Election Compass deleted
  theirs in 2024; Vote Compass publishes an essay explaining why its two charts disagree. A
  first-time voter shown two answers concludes the tool is broken.
- **An adaptive question selector.** Genuinely better, but non-deterministic — it breaks the
  same-inputs-same-output rule that makes `match.ts` testable and publishable.
- **A chat surface.** 24.9% of logged traffic to an LLM VAA was irrelevant chit-chat. Brigade's
  discussion pivot produced, in its own CEO's words, less substantive discussion and more personal
  attacks, then the company died.
- **An inferred-position tier** filled from party or endorsements. Vote Smart's middle state is
  where all its neutrality complaints live, and in an LLM-era product readers assume fabrication.

---

## 6. Corrections the critic made to the sweep

These are recorded because the same errors are easy to repeat.

| Claim | Correction |
|---|---|
| DISD publishes trustee boundaries only as map images; getting a shapefile into PostGIS is the pilot's hardest dependency | **False.** Two public keyless ArcGIS services exist — and **they disagree.** The same point returns District **9** from `TrusteeDistricts` and District **5** from `DISD_Trustee_SMD_Adopted_Dec_16_2021`. The first returns all-zero `Population`/`Voting_Age`, the signature of a draft redistricting layer. Verified independently. The real dependency is deciding which layer is authoritative and versioned to the election |
| Ballotpedia candidate survey response rate 19.2% | Real for 2024, wrong year. The 2025 odd-year local cycle ran **17.7%** of 4,526 candidates. Plan against that |
| Vote Compass "32M users, 75+ elections" | First-party says **33.6M surveys completed** (not users) and **50+ editions** (not 75+) |
| DMN "57% response rate" | Not published. The archived article says 285 responses from "more than 500" invited — 57% is a **ceiling**, not a rate |
| Google Civic representatives endpoint sunset | Confirmed, 2025-04-30 |

---

## 7. Design direction

Full specification in [`docs/DESIGN.md`](DESIGN.md). The short version: **Civic should look like a
public record, not a campaign and not a product.** The governing metaphor is the docket entry — a
dated, numbered, sourced row anyone can check, laid out edge-to-edge with hairline rules rather
than floated in rounded cards.

Four moves are load-bearing and specific to this product. The critic's judgment, which is correct,
is that everything else in the visual system is competent house style a good designer re-derives in
an afternoon:

1. **The Stance Rule** — direction encoded by *position* on a five-cell track, intensity by *ink
   value*, MIXED by *shape*. Hue never encodes politics. Simultaneously the WCAG 1.4.1 argument and
   the nonpartisanship argument: a product where color never codes a political direction cannot be
   accused of coloring one side favorably, and that is a claim you can point at pixels to defend.
2. **The Silence Receipt** — `NO_STATED_POSITION` renders larger than a stance, not smaller, with a
   dated enumeration of what was searched. Turns absence into *evidence of absence*. Nobody can copy
   it without building the archive first.
3. **Quote-in-source with the verified span marked** — show ~40 words of archived source with the
   verified span in `<mark>`. `findVerbatim` already returns offsets. It is the substring guarantee
   made visible, and the answer to a campaign lawyer's email: context, not just the span.
4. **Coverage ticks** — one tick per applicable issue, filled / hollow / struck, plus a literal
   fraction. The visual counterweight to the match percentage.

### One spec that contradicts its own research

The proposed `/e/[election]` sorts issues by *stance divergence among candidates in this election*.
Divergence is computed only over filled cells, so in a sparse grid the default ordering of the
product's main navigation is driven by which candidates generate the most extractable text. That is
Velez's bias — the criticism this document calls the strongest fair objection to the architecture —
re-encoded as the primary sort, one screen after the homepage promises Civic does not tell you how
to vote. **Do not ship divergence sort.** Use the taxonomy's editorial `sortOrder`.

---

## 8. What 409 sources did not cover

The sweep asked how other people build voter guides. It never asked whether Civic is permitted to
exist, can be paid for, or has an election to launch into. Zero legal, tax, or regulatory sources.

**Entity choice is product-determining and unmade.** IRS
[Rev. Rul. 78-248](https://www.eitc.irs.gov/pub/irs-tege/rr78-248.pdf) and
[2007-41](https://www.irs.gov/pub/irs-drop/rr-07-41.pdf) govern 501(c)(3) voter guides. The tests:
issues must encompass most major issues of interest to the entire electorate; candidate answers
must be **unedited**; the organization must avoid separately stating its own position. Civic breaks
at least one by construction — an LLM writes a two-sentence summary of each stance, which is
editing — and a weighted quiz emitting a ranked list of named candidates sits close to candidate
rating. Under a c3 that is live exposure in a 2028 Texas cycle. Under an LLC it is fine, and every
funding source that has ever paid for this category is closed.

Every reference standard in this document is funded by a newspaper, a government, or a membership
org: Vote Compass's Ontario push by the Atkinson, Toronto and Hamilton foundations; Wahl-O-Mat by
bpb; Policy.nz by 19 councils; Meet Your Mayor by THE CITY. And white space #5 — a durable
immutable URL per position surviving across cycles — is a permanent operating liability, not a
feature.

**[TRAIGA](https://capitol.texas.gov/tlodocs/89R/billtext/pdf/HB00149F.pdf)** (HB 149) took effect
2026-01-01, with AG enforcement and civil penalties to $100k per violation. An AI system publishing
stance claims about named Texas candidates sits inside a new, untested Texas regulatory surface
that this research did not touch once.

**Spanish is a source-scarcity problem, not a localization problem.** Al Día's newsroom was
[disbanded in March 2023](https://www.niemanlab.org/2023/02/the-dallas-morning-news-guts-its-spanish-language-newspaper-al-dia-after-19-years/)
and now runs translated DMN copy rather than original reporting. There is no large corpus of
original Spanish-language Dallas candidate material to extract from.
