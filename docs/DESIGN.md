# Design — Civic

Derived from the September 2026 landscape research (`docs/RESEARCH_2026-09.md`), which read 409
sources including every major US voter guide, the mature European VAAs, USWDS and GOV.UK, and the
Center for Civic Design content specs.

A note on what is load-bearing. The completeness critic’s judgment, which is correct and worth
keeping in front of you: four things here are specific to this product and irreplaceable — the
Stance Rule, the Silence Receipt, quote-in-source, and coverage ticks. The token, type and density
sections are a competent house style that a good designer would re-derive in an afternoon. Treat
§1 as decisions and §3 as defaults.

---

## 1. Positioning

Civic should look like a public record, not a campaign and not a product. The governing metaphor is the docket entry: a dated, numbered, sourced row that anyone can check, laid out edge-to-edge and separated by hairline rules rather than floated in rounded cards. Aesthetic reference points, named: Swiss transit signage (SBB departure boards, Bahnhof clock) for the monochrome stance track and the uppercase mono metadata line; American civic documents — the Texas Register, a certified ballot, a court docket — for the record-not-card layout and the position-ID permalinks; the FT and Reuters graphics desks for evidence density on a phone; Karel Martens / Werkplaats Typografie for warm-paper ground with ink and a single ochre, which is where the human warmth comes from instead of from illustration; USWDS/Public Sans for civic legitimacy in the UI voice. The anti-references are explicit and should be treated as failure conditions: Linear/Vercel dark-glass, shadcn's default zinc-with-a-blue-primary, Stripe gradient mesh, Duolingo gamification, and any hero image of a diverse group of people holding coffee. Three structural rules produce most of the look and are cheap to enforce: no box-shadows anywhere (depth is a value step between ground and surface, plus rules), no border-radius above 4px, and no saturated color on any control. The single loudest thing on screen is never a button — it is the candidate's own words on an ochre highlight. That is the right hierarchy for this product: the app is a delivery mechanism for a quote and a link, and the interface should visibly defer to them. It also solves the neutrality problem structurally rather than rhetorically. A product where hue never encodes a political direction cannot be accused of coding one side as the good color, and that is a claim you can point at pixels to defend.

---

## 2. Signature moves

These are the four that matter.

### The Stance Rule

**What.** A five-cell monochrome track that encodes stance by POSITION (oppose left → support right), intensity by INK VALUE (strong = full ink, plain = soft ink), and MIXED by SHAPE (a split diagonal cell). Always paired with the stance word in mono caps. One React component, a CSS grid of five divs, roughly 40 lines with no dependency. It appears in the issue comparison, on candidate pages, beside each quiz option, in quiz results next to the user's own answer, and inside the OG card.

**Why.** Every competitor either uses party red/blue, a colored chip, or a bare word. Encoding direction geometrically means the product is simultaneously WCAG 1.4.1-clean, grayscale-legible, dark-mode-trivial, and structurally unable to be accused of coloring one side favorably. It is also the cheapest possible primitive to build and the only one that survives a Satori render unchanged, which is why the share card can be the same component rather than a redrawn approximation.

### The Silence Receipt

**What.** NO_STATED_POSITION never renders on the stance track and is never greyed or shrunk. It renders as its own taller record: a dashed rule, the full-body-size sentence 'Ashworth has not stated a position on school start times', and then the receipt in mono — 'WE READ 6 SOURCES: campaign site (captured Mar 2), DISD candidate forum transcript (Mar 12), DMN questionnaire (Feb 28), 3 more' — with a <details> disclosing the full list of source titles and capture dates, and a dated freeze stamp. Zero JS; a <details> element and the Source rows the pipeline already writes.

**Why.** This is the hardest visual problem in the product and everyone else gets it wrong in the same direction: they either fill the gap from party (iSideWith), infer it (Vote Smart, Meet Your Mayor's non-responder), delete the candidate (Smartvote), delete the question (Election Compass), or print a silent blank (Dallas Morning News). Turning absence into evidence of absence — a dated, enumerated record of what was searched — makes the emptiest cell the most persuasive cell on the page, and it is only possible because Civic already archives sources per candidate with capture dates. Nobody can copy it without building the archive first.

### Quote-in-source, with the verified span marked

**What.** The evidence block does not show a bare pull quote. It shows roughly 40 words of the archived source text with the exact verified span wrapped in <mark> on the ochre band, plus the capture stamp and a link to the archived copy. findVerbatim already returns the matched span from the source, so the offsets exist; the component slices a context window around them.

**Why.** It is the substring guarantee made visible. BallotReady publishes quotation marks around text it admits it edits; Meet Your Mayor's 'quote' field silently degrades to paraphrase; two German LLM VAAs deviated from parties' stated positions in 25% and 54% of cases. Showing the quote inside its own surrounding source text is the one interface gesture that proves the claim rather than asserting it, and it is also the answer to a campaign lawyer's email: context, not just the span.

### Coverage ticks

**What.** A single row of one tick per applicable issue — filled (teal) where a published position exists, hollow outline where NO_STATED, struck where the issue does not apply to that office — followed by a literal fraction and one plain sentence. Flex container of small divs, no chart library. Reused as the quiz progress bar, on candidate headers, on issue-page rows, in quiz results, and on the share card.

**Why.** Velez's critique of AI voter tools is that loud candidates generate more extractable text than quiet ones, which is a bias Civic inherits directly. A per-candidate completeness meter makes a thin evidence base read as thin rather than as a real absence of position, and it is the visual counterweight to the match percentage — the matcher already computes coverage separately from score precisely so this can exist. One component pays for itself five times over.

### Answer-then-reveal quiz

**What.** Selecting an answer expands EVERY option, not just the chosen one, to show which candidates hold that position. The chosen option shows monograms plus stance tracks; unchosen options show a comma-joined list of full names with a 'See details' disclosure. Options nobody holds say so explicitly. Purely local component state, no routing, no animation library beyond a CSS height transition.

**Why.** It converts the quiz from a funnel into the comparison surface itself, so the roughly 60% of users who abandon partway still get the product's core value. Showing who agrees with the option you rejected is the highest-information move available and it costs nothing to build. It also front-loads the stance vocabulary, so the results screen needs no legend.

### Deal-breaker weighting, tap-only, on its own pass

**What.** After all questions are answered, a single screen lists every question with a three-state segmented control: Skip / Counts / Deal-breaker, mapping onto the matcher's existing weight 1|2|3. No slider, no drag, three 48px tap targets per row.

**Why.** It satisfies WCAG 2.2 SC 2.5.7 (no dragging movements) where every incumbent's importance slider fails it, it halves the per-question tap cost on mobile relative to iSideWith, it is the one weighting concept an 18-year-old immediately understands, and it is the mitigation the ETH robustness paper proposed to Smartvote's operator for hedging-driven gaming. Separating it from the answering pass is Wahl-O-Mat's structure and measurably improves both answers.

---

## 3. Tokens

**Rationale.** Hue is removed from the political layer entirely and spent on provenance instead. Direction (oppose ↔ support) is encoded by POSITION on a five-slot track; intensity (strong vs. plain) is encoded by INK VALUE; MIXED is encoded by FORM (a split cell). All six stance values are therefore distinguishable in grayscale, in dark mode, at 1x, and to any form of color vision deficiency — which is simultaneously the WCAG 1.4.1 compliance argument and the nonpartisanship argument. The only chroma in the product is an archival ochre used exclusively as the highlight band behind a verbatim quote, and one deep teal used exclusively for the coverage meter. Nothing else is colored, including buttons, which are ink + rule + underline. Ground is warm paper rather than #FFF and warm near-black rather than blue-black, because blue-black is the current SaaS tell and warm grounds read as document.

### Palette

LIGHT — ground #FAF8F4 (warm paper, never #FFF), surface #FFFFFF, surface-sunk #F1EDE5 (evidence block), ink #14130F (16.9:1 on ground), ink-2 #55524A (7.4:1, used for summaries and never for absence), rule #D8D2C6 (decorative hairlines), rule-strong #8A8377 (3.6:1, any rule that bounds a control), focus #14130F with 2px offset ring. DARK — ground #131210, surface #1B1A16, surface-sunk #22201B, ink #F3F0E8 (15.8:1), ink-2 #A8A296 (7.2:1), rule #34312A, rule-strong #6A6459. STANCE ENCODING (no party color, no red/green): a 5-cell track, cells ~24x14px with 2px gaps, read left→right as STRONG_OPPOSE · OPPOSE · MIXED · SUPPORT · STRONG_SUPPORT. The active cell is filled with --stance-strong (= ink) for STRONG_*, and --stance-soft (#6B675E light / #97917F dark, both ≥5:1 and ≥3:1 as a non-text mark per 1.4.11) for plain OPPOSE/SUPPORT. MIXED fills the center cell as two ink half-triangles meeting on a diagonal — a distinct SHAPE, not a distinct color. Inactive cells are a 1px rule-strong outline with no fill. The stance word ('OPPOSES', 'STRONGLY SUPPORTS') always sits immediately right of the track in 12px mono caps, so the track is redundant encoding, never the sole carrier. NO_STATED_POSITION never appears on the track at all — see the Silence Receipt. PROVENANCE CHROMA — mark (quote highlight) #F2D680 light / #4A3A12 dark, with quote text at ink / #F5E9C4 respectively, both >9:1 on the band; the mark also carries a 1px bottom rule so it survives forced-colors mode. METER (coverage ticks only) #17605B light / #5FBFA9 dark, ~7:1 both ways. PARTY is rendered as a single letter in a 1px hairline circle at ink-2 — same treatment for D, R, L, G, I, and nonpartisan. There is no party color token in the system and a lint rule should keep it that way. Dark mode is a token swap only: because stance is ink-on-ground, the track inverts correctly with zero per-component dark: variants.

### Type

Three families, all open-licensed, chosen so the system reads as document rather than dashboard. Source Serif 4 for anything that is the record: h1, issue titles, and every verbatim quote — a reading serif is the single strongest anti-SaaS move available and it visually separates the candidate's words from Civic's chrome. Public Sans for all UI, names, summaries, and controls (it is literally the US federal typeface; free civic credibility, and it is not Inter). IBM Plex Mono for every piece of metadata: dates, source domains, capture stamps, position IDs, ballot-order notices, progress counters. MOBILE SCALE (375px baseline, all px, 4pt-derived): mono-label 12/1.2 at +0.08em uppercase; caption 13/1.45; body 16/1.55; summary 17/1.5; quote (serif) 19/1.55; issue title (serif) 22/1.3; h1 (serif) 30/1.15. Body floor is 16px and summaries are 17px — this is a reading product for someone who has never read a ballot, not a dashboard, so nothing informational is ever set below 13px and absence text is set at full body size. Measure is capped at 62ch with a max-width on the text column even on mobile. Weights: 400 body/quote, 600 names and stance words, 700 h1 only. No italics except for source titles. Line-height never drops below 1.45 on any multi-line text (1.4.12 text-spacing must survive user overrides — test at 1.5x line-height, 0.12em letter-spacing).

### Density and spacing

4pt base with an 8/16/24/40 vertical rhythm. Records are full-bleed with a 20px horizontal gutter and a 1px rule between them — never a card, never a shadow, never a radius above 4px (the monogram tile is 2px; everything else is 0). One candidate record on the issue page occupies roughly 200px collapsed and expands with <details>; five candidates fit in about two thumb-scrolls. Minimum tap target 44x44 (WCAG 2.2 SC 2.5.8 requires 24x24; 44 is the working floor and every stance option, chip, and disclosure meets it). No control anywhere requires a drag: SC 2.5.7 rules out the importance slider that iSideWith and Smartvote use, which is also why the weight control is a three-state tap segment. Sticky chrome is capped at 48px so SC 2.4.11 (focus not obscured) holds when tabbing through a long candidate list — verify by keyboard on the issue route specifically. Focus is a 2px ink ring with a 2px offset, never removed, and visible against both ground and surface-sunk.

---

## 4. Anti-patterns

Failure conditions, not suggestions. The first eight are derived from specific competitor failures
recorded in the research; the rest are WCAG 2.2 and general-taste restatements.

1. Never use party red/blue — or any party-associated hue — as a UI color, including on party letter badges, incumbent tags, chart marks, or the share card. There should be no party color token in the codebase and a lint rule should keep one from appearing.
2. Never encode stance by hue alone, and never use red/green for oppose/support. Direction is position on the track; a colorblind reader and a grayscale screenshot must both resolve all six values.
3. Never grey out, shrink, italicize, or right-align NO_STATED_POSITION. Muted low-contrast absence is the single most common failure in the category and it reads as a broken cell rather than a finding. It gets full body contrast and more vertical space than a stance row, not less.
4. Never fill an absence from party, endorsements, donors, a voting record on an adjacent issue, or another candidate — and never render an inferred stance in the same component as an evidenced one. Vote Smart's 'Inferred Position' tier is where every neutrality complaint in that product lives.
5. Never truncate a candidate name to fit a control. OnTheBallot's mobile tab strip renders Texas Senate candidates as 'Tala… | Cor…', which is unusable. If names do not fit horizontally, stack them.
6. Never ship two result visualizations that can disagree. Vote Compass needs an essay to explain why its map and its bars name different winners; Election Compass simply deleted its map in 2024. One measure, one ranking.
7. No 2D ideology map, no 8-axis radar/spider, and no left–right axis anywhere. They are illegible at 375px, they require pilot survey data Civic will not have, and a single left–right spectrum cannot represent a nonpartisan municipal race at all.
8. Never order candidates by fundraising, poll standing, incumbency, participation, or alphabetically-as-tiebreak. Ballot order, disclosed in a visible line; ties shown as ties, broken by seeded shuffle. Rank 1 alone is worth 2–6 points of vote probability, so ordering is an intervention, not a presentation detail.
9. Never interleave endorsements or 'our recommendation' into a comparison view, and never structurally cap how many candidates can be compared or shown. A Wahl-O-Mat comparison cap was struck down as a violation of party equal-opportunity rights.
10. No drag-based importance slider (fails WCAG 2.2 SC 2.5.7 and doubles per-question tap cost), no swipe-only answering without visible buttons, and no control whose only state signal is a color change.
11. Never put paraphrase inside quotation marks, and never edit words inside a displayed quote. Bracketed editorial insertions must be stored separately from the raw span the substring check runs against, or your own test will start failing on your own annotations.
12. Never emit a quiz answer value, an option index, a per-candidate ranking, or a match percentage into any analytics event. The full result ordering is a near-unique fingerprint of the answer set; shipping it is functionally persisting answers.
13. Never bury the 'this is not a voting recommendation' line in a footer. It goes above the Start button at full size, the way Wahl-O-Mat places it for 26 million users.
14. Never headline a field the pipeline cannot fill from public sources. Voter's Edge promoted 'their top 3 priorities' on every race page and that field was structurally unfillable for exactly the non-participating candidates voters knew least about.
15. Never present a raw match percentage without the coverage that produced it, and never let a candidate with one matching position outrank one with twelve. The matcher already separates score from coverage; the UI must never collapse them back together.
16. Avoid the AI-SaaS visual signature entirely: rounded shadowed cards, a blue primary button, gradient mesh backgrounds, emoji section headers, scroll-triggered fade-ups, glassmorphism, blue-black dark mode, and Inter set at 14px on #FFFFFF. Also avoid the opposite failure — a bootstrap-default table with no typographic system.
17. Never mix candidate photos and monogram tiles in the same list, and never crop or filter photos. Inconsistent identity marks read as editorial preference. Monograms for everyone, uniformly, until photo sourcing is uniform.
18. No chatbot surface, no comments, no likes, no follows, and no discussion feature. Brigade shut down after concluding openness produced 'less substantive discussion, more personal attacks'; observed LLM voter-guide traffic ran roughly 25% irrelevant chit-chat.

---

## 5. Screens

Every route the roadmap names.

### `/`

**Purpose.** Turn an address into a district, set the honesty frame before anything else, and let a user who won't type an address in still get to the data.

**Layout.** Wordmark 'Civic' in Public Sans 20/600 with a 2px ink rule beneath, and under it a mono caps line: ISSUE-FIRST VOTER GUIDE · DALLAS COUNTY, TX. H1 in Source Serif 30/1.15, max 12 words: 'See what they actually said. With the quote and the link.' Then — above the input, not in a footer — a three-line frame block, each line preceded by a short ink rule, at full body contrast: 'Civic does not tell you how to vote.' / 'Every stance links to the candidate's own words in an archived source.' / 'If a candidate hasn't said, we say so.' Address field: full-width, 56px, visible <label> above (never placeholder-as-label), 17px, autocomplete="street-address", inputmode text, with a mono helper beneath: WE TURN YOUR ADDRESS INTO A DISTRICT AND DISCARD IT. NOTHING IS STORED. Submit is an ink button with a 1px rule, not a colored pill. Secondary text link: 'Or browse without an address →'. Below: the election picker as rule-separated records — election name in serif 20, date in mono, and a coverage line ('14 races · 61 candidates · positions on 12 of 20 issues'), chevron right. Only elections with published data render. Footer: How we do this · Corrections log · Methodology, plus a mono stamp TAXONOMY 0001 · DATA THROUGH APR 18, 2027.

*Draws on:* Wahl-O-Mat (bpb) puts 'keine Wahlempfehlung' above the Start button rather than in a footer; VOTE411's address-first entry; guides.vote's refusal to decorate.

### `/e/[election]`

**Purpose.** Choose an issue, and see up front how thin or thick the data is before trusting anything downstream.

**Layout.** Header: election name in serif 22, date in mono, then a coverage disclosure strip at full contrast — '61 candidates · 1,043 published positions · 218 no stated position' with an inline 'how we count' link. Two entry points as a segmented pair of equal-weight ink buttons (no active blue pill): 'Browse issues' / 'Take the quiz · 2 min'. Level filter as a row of chips: All / City Council / DISD Trustee — chips are 1px rule-strong outlines, selected state is a filled ink chip with inverted text, never a color change alone. Issue list is rule-separated records, each: issue name in Source Serif 22, the neutral one-sentence taxonomy definition in 15/1.45 ink-2, then a mono divergence line — 6 CANDIDATES · 4 STANCES DIFFER · 2 NO STATED. Sorted by measured stance divergence within this election, with the sort disclosed in one line above the list: 'Issues where the candidates on your ballot disagree most, first.' plus a small 'A–Z' toggle. Issues masked out by office level never render at all.

*Draws on:* OnTheBallot's per-row issue definition; Vote Compass and Stemwijzer's discriminating-power question selection, but with the sort disclosed rather than hidden; Center for Civic Design's one-topic-one-heading rule.

### `/e/[election]/i/[issue]`

**Purpose.** The product. Every candidate in the race on one issue, with stance, plain summary, verbatim quote in its source context, and the link — and honest silence where there is silence.

**Layout.** Slim sticky header (48px): issue name on one line, ‹ › prev/next issue. Below: issue definition, then a mono provenance line 20 SOURCES READ · LAST CHECKED APR 18, 2027. If the issue spans multiple races, a race selector with FULL race names stacked vertically — never a truncated horizontal tab strip. Then a mono notice BALLOT ORDER · NOT RANKED, and a 'Hide no stated position' switch defaulting OFF (when on, a persistent line reads '3 candidates hidden'). The comparison is a vertical stack of candidate records, each: [1] 32px monogram tile (two letters, 1px ink outline, no fill) + name Public Sans 17/600 + party letter in a hairline circle + INCUMBENT in mono 11 caps; [2] the Stance Rule — 5-cell track ~140px wide with the stance word in mono caps beside it, aria-label 'Strongly opposes: Sarah Weinberg on school start times'; [3] the two-sentence summary at 17/1.5; [4] the evidence block on surface-sunk with a 3px left ink rule: about 40 words of the archived source with the verified span wrapped in <mark> on the ochre band, set in Source Serif 19/1.55, then a mono line CANDIDATE SITE · CAPTURED MAR 2, 2027 · sarahweinberg.com ↗ and a 'View archived copy' link; [5] a collapsed <details> 'Why this stance' holding the coding rule that applied (conditions/qualifications test) and the position ID pos-0438 in mono as a permalink. NO_STATED_POSITION replaces [2]–[5] entirely with the Silence Receipt. Sticky bottom bar is avoided; the prev/next issue pair repeats at the end of the list.

*Draws on:* OnTheBallot's cell anatomy and 'Hide no mention' toggle; guides.vote's research-notes rule (keep the surrounding paragraphs, not just the matched span); Meet Your Mayor's per-candidate quote + source line; Wahl-O-Mat's Begründungen view, with authorship inverted from party PR to archived candidate speech.

### `/c/[slug]`

**Purpose.** The candidate's whole record, with coverage stated before any position so sparsity reads as disclosure rather than as thin content.

**Layout.** Name in Source Serif 30, office and party beneath in Public Sans 15, incumbency dates in mono. No photo hero, no bio, no endorsements, no donor totals in v1 — nothing whose ordering could be argued. Immediately under the name: the coverage meter — a single row of ticks, one per issue that applies to this office, filled in --meter where a published position exists, hollow rule-strong where NO_STATED, and rendered as a struck-through tick where the issue does not apply — followed by the literal fraction '12 / 18' and a plain sentence: 'We found positions on 12 of the 18 issues that apply to this office. On 6 she has not stated a position.' Then positions grouped by issue, each using the exact same record component as the issue route (component reuse is the point — a user learns one row shape and it holds everywhere). For incumbents, a Voting record section: rule-separated roll calls, each NOV 13, 2024 · AGENDA ITEM 24-1839 · VOTED NO with the tagged issue and a link, headed by a mono badge INGESTED FROM THE OFFICIAL RECORD · NOT MODEL-EXTRACTED. Footer of the record: 'Report a problem with this page' and 'Are you this candidate?', both explaining in one line that a correction creates a new dated row and the original stays visible.

*Draws on:* Meet Your Mayor's filled/hollow circle scorecard; OnTheBallot's coverage_percentage; EuroMPmatch's roll-call-record sourcing; Ballotpedia's append-only correction policy stated at the point of correction.

### `/e/[election]/quiz`

**Purpose.** Twelve questions in two minutes that produce one honest number, and that teach the stance language on the way through.

**Layout.** Screen 0 before Start: the disclaimer at full size, not a footer — 'This is not a voting recommendation.' / 'Your answers stay on your phone. We do not store them and no analytics event contains them.' / '12 questions · about 2 minutes.' then a single Start button. Question screens are one per viewport: mono counter 03 / 12 plus a tick progress row reusing the coverage tick component; question in Source Serif 24/1.25, always phrased in the allow/expand direction (never 'ban', never 'not') per the polarity research; a <details> 'What this means' with two neutral sentences and an outbound link. Answer control: five stacked full-width 48px buttons, label left, and the matching 5-cell stance glyph right so the visual language is learned before results; then a visually separate 'Skip — this one doesn't matter to me' button, which is NOT the middle option. On answer, nothing collapses: every option expands to name the candidates who hold it, as a monogram row (chosen option) or a comma-joined full-name list with a 'See details' toggle (unchosen). Options no candidate holds render 'No candidate on this ballot has said this.' The chosen option gains a 3px left ink rule; others drop to ink-2 (still ≥7:1) and stay tappable. A SEPARATE weighting pass follows all 12 questions: every question listed with a three-state tap segment Skip / Counts / Deal-breaker (mapping to the matcher's existing weight 1|2|3), no dragging anywhere. Results: ONE measure, never two. Headline names every candidate tied at the top. Each result is a <details>: name, coverage ticks, 'NN% agreement on 9 of the 12 issues you answered', and the standing line 'Agreement is only counted on issues where this candidate has a published position.' Expanded: three buckets — agreed / partly agreed / disagreed — each listing issues with your stance track above theirs, every row linking to the position record. Any candidate under 50% coverage carries a full-contrast line: 'Low coverage — this number rests on 4 of your 12 answers.' A permanent footer line reads 'Ranked by agreement. Ties are shown as ties.'

*Draws on:* Meet Your Mayor's answer-then-reveal and three-bucket breakdown plus shuffle-before-sort ties; Wahl-O-Mat's separation of answering from weighting; euandi's skip ≠ neutral; Berdoz et al.'s deal-breaker weight set; Vote Compass's disclaimer placement, minus its two disagreeing charts.

### `/e/[election]/quiz/card`

**Purpose.** A share artifact that carries evidence rather than a personality score, and that cites itself.

**Layout.** 1200x630 via next/og. Warm paper ground with a 1px ink frame inset 32px. Top-left the wordmark and rule; top-right a mono line DALLAS MUNICIPAL · MAY 1, 2027. Body is three rows, one per top issue: the issue name in Source Serif 34 on the left, and on the right the two closest candidates as monogram + surname + their 5-cell stance track, side by side — so the card shows POSITIONS, not a percentage. Under them, one line at full contrast: 'Based on 9 of 12 issues. 3 had no stated position.' Bottom band: civic.vote/e/2027-05-dallas plus a QR to the election route. No user data in the URL beyond issue and candidate slugs in the signed, expiring param. Because the stance track is plain divs with background colors and no SVG or webfont trickery, it renders identically in Satori and in the app — the same component, twice.

*Draws on:* Civic Align's 'the citation travels with the summary'; Meet Your Mayor's pre-rendered per-candidate OG composites; the deliberate rejection of iSideWith-style score-hero cards.

---

## 6. One spec that is wrong

The original synthesis proposed sorting issues on `/e/[election]` by stance divergence among the
candidates in that election. Do not build it. Divergence can only be computed over filled cells, so
in a grid the research predicts will be sparse and NO_STATED-dominated, the default ordering of the
product’s primary navigation would be driven by which candidates generate the most extractable
text. That is Yamil Velez’s critique — the strongest fair objection to this architecture — encoded
as the main sort, one screen after the homepage promises Civic does not tell you how to vote.

Use the taxonomy’s editorial `sortOrder`, filtered by the office’s level mask.
