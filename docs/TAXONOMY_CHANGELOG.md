# Taxonomy changelog

Every addition, removal, rename, or level-mask change to the issue list in
`packages/db/src/seed.ts` gets an entry here. Editorial decision, not a migration
convenience. Newest last.

## 0001 — Initial taxonomy (2026-09-02)

20 issues seeded with level masks. Established by bootstrap; not yet reviewed by a
second reader (Phase 0 acceptance requires review by at least one person who would
vote differently). Descriptions are empty and must be written before the pilot.

| slug | name | levels |
|---|---|---|
| economy-jobs | Economy & Jobs | all |
| housing-cost-of-living | Housing & Cost of Living | all |
| taxes-budget | Taxes & Budget | all |
| education-k12 | K-12 Education | city, county, school district, state |
| higher-ed-student-debt | Higher Ed & Student Debt | state, federal |
| healthcare | Healthcare | state, federal |
| reproductive-rights | Reproductive Rights | state, federal |
| public-safety-policing | Public Safety & Policing | all |
| criminal-justice | Criminal Justice | all |
| guns | Gun Policy | state, federal |
| immigration | Immigration | state, federal |
| climate-energy | Climate & Energy | all |
| environment-water | Environment & Water | all |
| transportation-infrastructure | Transportation & Infrastructure | all |
| voting-elections | Voting & Elections | all |
| lgbtq-rights | LGBTQ+ Rights | all |
| civil-rights | Civil Rights & Equality | all |
| tech-privacy-ai | Technology, Privacy & AI | state, federal |
| foreign-policy-defense | Foreign Policy & Defense | federal |
| local-development-zoning | Development & Zoning | city, county, school district |

## 0002 — Descriptions written; taxonomy unchanged (2026-09-03)

No issue was added, removed, renamed, or re-masked. All 20 descriptions, empty since
entry 0001, are now written.

Process, because the roadmap's Phase 0 acceptance requires review by someone who would
vote differently: each paragraph was drafted, then read by two adversarial reviewers —
one instructed to find framing that concedes a conservative premise, one to find framing
that concedes a progressive premise, both quoting the exact words they objected to. An
editor revised against both reads under a fixed rule: an objection that the text uses one
side's coined term is honored; an objection that the text should also assert the
reviewer's preferred claim is rejected, because descriptions assert nothing. A final pass
unified voice across the set.

All 20 paragraphs changed. On nine issues — housing, taxes, reproductive rights, public
safety, criminal justice, guns, civil rights, climate, and voting — both reviewers
objected to the *same* clause from opposite directions, which is the signal that the
sentence was describing the dispute rather than the decision. Those were rewritten to name
what the office actually decides.

A representative fix: `guns` originally listed only restrictions imposed on a lawful
owner, so the decision set itself carried a premise before any candidate's stance was
shown. It now names the decisions — what checks happen before a sale, whether a permit is
required to carry, when a court may remove firearms and on what proof — without implying a
direction.

Still open for Phase 0: a human reader, not a model, has to sign off on these.

## 0003 — DECLINED_TO_STATE added to the stance scale (2026-09-04)

Not a taxonomy change; recorded here because it changes what a cell can say.

`NO_STATED_POSITION` was doing two jobs. A candidate who was asked and refused is
different data from a candidate whose public record is silent, and the refusal is itself
informative to a voter. `DECLINED_TO_STATE` splits them. Both are excluded from the
matcher — imputing a midpoint for either would make silence read as moderation — and both
are shown to users as themselves.

Source: `docs/RESEARCH_2026-09.md` §4. guides.vote separates Mixed / Unclear / No position
found / drop-the-question; Meet Your Mayor merges refusal into silence and then re-splits
them at render time by inspecting strings.

## 0004 — Level masks narrowed; issue-per-office enforced (2026-09-04)

No issue added, removed or renamed. Six level masks narrowed, and the mechanism that
uses them changed.

Building the issue comparison against the Dallas fixture made a latent problem visible:
`housing-cost-of-living` was masked `ALL`, so the Housing page listed all four Dallas ISD
trustee candidates and recorded "no stated position" against each of them. A school board
does not set housing policy. That row is not a finding — it is a manufactured silence,
counted against a candidate for declining to answer a question nobody asked them. The
research names this as the fastest way to look unserious to a local reporter
(`docs/RESEARCH_2026-09.md` §4, issue-per-office tagging).

Two changes:

1. **The mask is now enforced.** `/v1/elections/:slug/issues/:issueSlug` returns only
   candidates whose office sits at a level in that issue's mask. Previously the mask
   filtered which issues appeared in the grid but not which candidates appeared under one.

2. **Six masks corrected.**

   | Issue | Was | Now | Why |
   |---|---|---|---|
   | `housing-cost-of-living` | ALL | all but school district | A trustee sets no housing rule, rate or subsidy |
   | `criminal-justice` | ALL | all but school district | Charging, bail, sentencing and jails are not district decisions |
   | `climate-energy` | ALL | all but school district | Utilities, grid and permitting are not district decisions |
   | `environment-water` | ALL | all but school district | Drinking water, sewer and floodplain rules are not district decisions |
   | `voting-elections` | ALL | all but school district | A district administers no election and draws no map |
   | `education-k12` | city, county, school district, state | school district, state | In Texas, DISD is independent of the City of Dallas. A council member sets no curriculum, no campus budget and no start time |

Deliberately left at `ALL`: `taxes-budget` (a district sets a tax rate), `economy-jobs`
(teacher pay is in the description), `transportation-infrastructure` (school bus service),
`public-safety-policing` (officers assigned to schools), and the civil-rights pair (both
reach school settings directly). Each of those is a decision a trustee actually makes.
