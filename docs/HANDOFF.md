# Handoff — 2026-09-03

Paused mid-task. Everything below is committed and pushed to `main`.

## State

| Thing | State |
|---|---|
| Monorepo, Postgres, migration, seed | working (`docker compose up -d`, Postgres on **5433**) |
| `pnpm typecheck` / `lint` / `test` / `build` | all green; 9 tests |
| Model seam `packages/extract/src/llm.ts` | written, typechecks, **never made a successful live call** |
| Public/admin API, web app | boot and serve; web is still the bootstrap placeholder page |
| Position rows in DB | zero — correct for this stage |

## Blocker: the Anthropic key is identity-linked

Every request 400s with:

    anthropic-workspace-id is required when authenticating with an identity-linked API key

Fix: put the workspace id in the repo-root `.env` (the slot is already there, and the
SDK reads it automatically).

    ANTHROPIC_WORKSPACE_ID=wrkspc_...

Found in Console → Settings → Workspaces. A non-identity-linked key needs no workspace id.

Then verify the seam end to end — this makes two real model calls and costs a few
tenths of a cent:

```bash
pnpm --filter @civic/extract smoke
```

It runs a synthetic Dallas council statement through `claude-opus-5` and
`claude-sonnet-5`, prints both extractions, reconciles them, and asserts every
returned quote is verbatim in the source. That is the Phase 0 fidelity harness in
miniature — once it passes, swap the synthetic document for the 5 hand-labeled
real candidate sites.

## Interrupted: landscape research

A 27-agent research workflow was stopped partway. Completed agents are cached, so
resuming replays them for free rather than re-running the searches:

    Workflow({
      scriptPath: "~/.claude/projects/-Users-willfoti-Documents-GitHub-civic/dd89ef1e-d137-4cba-9235-a244a3cbe463/workflows/scripts/civic-landscape-research-wf_084d9dca-c9d.js",
      resumeFromRunId: "wf_084d9dca-c9d"
    })

It sweeps and deep-reads 12 angles — US national voter guides, local/municipal
coverage, quiz and matching tools, international VAAs (Wahl-O-Mat, smartvote,
StemWijzer, Vote Compass), the academic VAA literature, civic-tech orgs and
funders, newsroom voter guides, election data infrastructure, shutdown
post-mortems, USWDS/GOV.UK design systems, WCAG and plain-language standards, and
youth outreach plus share-card mechanics — then produces a competitive/expert map,
a design direction, and a completeness critic that spot-checks claims against live
sources.

Its output is the input to two things that have not started: the roadmap update
and the real UI. `apps/web` is still the placeholder from bootstrap.

## Next

1. Set `ANTHROPIC_WORKSPACE_ID`, run the smoke check.
2. Resume the research workflow; fold results into `docs/ROADMAP.md`.
3. Build the design system and the six routes the roadmap names.
4. Phase 0 acceptance is still open: `SOURCES.md`, issue descriptions (all 20 are
   empty strings in the seed), a second reader on the taxonomy, and the fidelity
   numbers in `docs/PHASE0_RESULTS.md`.
