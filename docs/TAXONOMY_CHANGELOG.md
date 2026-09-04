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
