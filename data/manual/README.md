# Manually entered data

Two things live here, both for cases where no machine-readable source exists.

## `questionnaire.template.csv`

Candidate questionnaire answers. Copy the template, fill it in, and run
`pnpm ingest questionnaire --file <path> --election <slug>`.

**Why this is a CSV.** Vote411 (League of Women Voters) has no public API — its ballot
tool is a client-side app with obfuscated keys — and Vote Smart's documented endpoints
return 404. Both were checked in September 2026. Scraping Vote411 would also mean taking
the League's editorial work, which is not something to do quietly.

So the path is a person entering answers from a source they lawfully obtained: a
partnership feed, a newspaper questionnaire, a candidate's emailed reply, a forum
someone attended, a debate transcript.

**Why it fits without a new model.** A questionnaire answer is already what this product
wants — a candidate answering one fixed question. There is nothing to extract and
nothing to verify, because the candidate answered. Debate and forum transcripts go
through the same file for the same reason.

**The rules, enforced by the parser:**

| Column | Required | Why |
|---|---|---|
| `candidate_slug` | yes | |
| `issue_slug` | yes | must match a seeded issue |
| `stance` | yes | one of the seven stances |
| `quote` | for a stance, never for an absence | An answer with no quote is an assertion about a person with nothing behind it. An absence carrying a quote is a contradiction — the quote is the candidate saying something. |
| `source_url` | yes | a reader must be able to check it |
| `source_title`, `publisher`, `answered_at` | no | |

A row that breaks any of these is refused with its line number. It is never silently
dropped, and the good rows in the same file still load.

## Local race rosters

`data/manual/<election>/candidates.csv` for city and school-board races in states whose
Secretary of State does not publish them. See `docs/INGEST.md`.
