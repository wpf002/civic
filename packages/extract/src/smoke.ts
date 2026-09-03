/**
 * Live check of the model seam against a synthetic candidate statement.
 * Costs real money — a few tenths of a cent per run. Deliberately NOT part of
 * `pnpm test`: CI never calls a model.
 *
 *   pnpm --filter @civic/extract smoke
 *
 * If the API key is identity-linked, ANTHROPIC_WORKSPACE_ID must also be set;
 * the API returns a 400 naming that header when it is missing.
 */
import { extractOnce, reconcile } from "./pipeline.js";
import { MODEL_A, MODEL_B } from "./llm.js";

// Synthetic candidate-website text. Deliberately mixes a clear stance, a hedge,
// and an issue the document never mentions.
const DOC = `Priorities — Maria Delgado for City Council, District 7

Housing. Our neighborhoods are getting more expensive every year. I will vote to
allow duplexes and fourplexes on every residential lot in District 7, and I will
push to cut the parking minimums that make small apartment buildings impossible
to finance.

Public safety. I have heard from residents who want more patrols and from
residents who want fewer. I am not going to pretend that is a simple question. I
support fully funding the department's current headcount while we finish the
independent response-time audit, and I will decide on any expansion after I read it.

Streets and transit. DART's bus network works for people who live near a frequent
route and fails everyone else. I will fund sidewalk repair in every neighborhood
before we spend another dollar on downtown streetscape projects.`;

const ISSUES = [
  "housing-cost-of-living",
  "public-safety-policing",
  "transportation-infrastructure",
  "climate-energy",
  "reproductive-rights",
];

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Add it to the repo root .env.");
  process.exit(1);
}

const t0 = process.hrtime.bigint();
const [a, b] = await Promise.all([
  extractOnce({ sourceText: DOC, issueSlugs: ISSUES }, MODEL_A),
  extractOnce({ sourceText: DOC, issueSlugs: ISSUES }, MODEL_B),
]);
const secs = Number(process.hrtime.bigint() - t0) / 1e9;

for (const o of [a, b]) {
  console.log(`\n=== ${o.model}  (${o.costCents.toFixed(3)}c) ===`);
  for (const p of o.positions) {
    console.log(`  ${p.stance.padEnd(19)} ${p.issueSlug.padEnd(30)} conf=${p.confidence}`);
    console.log(`      summary: ${p.summary}`);
    if (p.quote) console.log(`      quote:   "${p.quote.slice(0, 90)}${p.quote.length > 90 ? "…" : ""}"`);
  }
  for (const r of o.rejected) console.log(`  REJECTED ${r.position.issueSlug}: ${r.reason}`);
}

const { agreed, flagged } = reconcile(a, b);
console.log(`\n=== reconcile ===`);
console.log(`agreed  -> DRAFT:      ${agreed.map((p) => `${p.issueSlug}=${p.stance}(${p.confidence})`).join(", ") || "(none)"}`);
console.log(`flagged -> ReviewTask: ${flagged.map((f) => `${f.issueSlug}[A=${f.a?.stance ?? "-"} B=${f.b?.stance ?? "-"}]`).join(", ") || "(none)"}`);
console.log(`\ntotal ${(a.costCents + b.costCents).toFixed(3)}c, ${secs.toFixed(1)}s`);

// Hard gate: every stored quote must be verbatim in the source.
const bad = [...a.positions, ...b.positions].filter((p) => p.quote && !DOC.includes(p.quote));
console.log(bad.length === 0 ? "\nQUOTE GATE: all quotes verbatim ✓" : `\nQUOTE GATE FAILED on ${bad.length}`);
