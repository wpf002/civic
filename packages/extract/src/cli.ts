import { Command } from "commander";
import { prisma } from "@civic/db";
import { MODEL_A, MODEL_B } from "./llm.js";
import { runExtraction } from "./pipeline-db.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  ABSENT,
  cityIssueSlugs,
  loadArchive,
  loadLabelsBySlug,
  loadProposedLabels,
  fromRepoRoot,
  runExtractors,
  score,
  type LabelSet,
} from "./phase0.js";
import { VERIFY_MODEL, directionRatio, runVerification } from "./verify.js";
import { proposeMappings, verifyMappings, type BillInput } from "./bills.js";
import { adminSessionToken } from "@civic/core";

const program = new Command("civic-extract");

program
  .command("run")
  .description("Extract positions from archived sources. Writes DRAFTs; publishes nothing.")
  .option("--source <id>")
  .option("--candidate <slug>")
  .option("--limit <n>", "cap sources processed", (v) => Number(v))
  .option("--model-a <id>", "first extractor model", MODEL_A)
  .option("--model-b <id>", "second, independent extractor model", MODEL_B)
  .option("--concurrency <n>", "sources processed at once", (v) => Number(v), 6)
  .option("--dry-run", "report what would happen and write nothing")
  .action(async (o) => {
    const started = Date.now();
    const report = await runExtraction({
      concurrency: o.concurrency,
      onProgress: (done, total, label) => {
        // A run that prints nothing for an hour is indistinguishable from one that hung.
        const mins = (Date.now() - started) / 60000;
        const left = mins > 0 ? Math.round((total - done) / (done / mins)) : 0;
        process.stderr.write(`  [${done}/${total}] ${left} min left · ${label}\n`);
      },
      ...(o.source ? { sourceId: o.source } : {}),
      ...(o.candidate ? { candidateSlug: o.candidate } : {}),
      ...(o.limit ? { limit: o.limit } : {}),
      modelA: o.modelA,
      modelB: o.modelB,
      dryRun: !!o.dryRun,
    });

    for (const d of report.details) {
      console.log(`\n${d.candidate ?? "(unlinked)"} — ${d.sourceUrl}`);
      if (d.error) console.log(`  ERROR ${d.error}`);
      if (d.agreed.length) console.log(`  draft:   ${d.agreed.join(", ")}`);
      if (d.flagged.length) console.log(`  review:  ${d.flagged.join(", ")}`);
      if (d.rejected.length) console.log(`  dropped: ${d.rejected.join(", ")}`);
    }

    console.log(
      `\n${report.sources} sources · ${report.drafts} drafts · ${report.flagged} to review · ` +
        `${report.rejectedQuotes} quotes dropped · ${report.refusals} refusals · ` +
        `${report.costCents.toFixed(2)}c` + (o.dryRun ? "  (dry run, nothing written)" : ""),
    );
    await prisma.$disconnect();
  });

program
  .command("publish")
  .description("Publish positions that survived verification. Goes through the admin API, never straight to the database.")
  .option("--election <slug>")
  .option("--limit <n>", "cap", (v) => Number(v))
  .option("--absences", "also publish 'no stated position', for candidates we archived something for")
  .requiredOption("--reviewer <name>", "who is accountable for what goes live")
  .option("--api <url>", "admin API base", process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000")
  .option("--dry-run")
  .action(async (o) => {
    const token = await adminSessionToken(o.api);

    // Only IN_REVIEW: the verifier moves a position there when a quote survived an
    // independent reading. A DRAFT has not been checked and does not go live.
    //
    // With --absences, also publish NO_STATED_POSITION rows — but ONLY for candidates
    // we actually archived something for. "This candidate has not stated a position"
    // is a claim about them; "we have not researched this candidate" is a claim about
    // us, and publishing the second as the first is the worst thing this product can
    // do. A candidate with no archived source gets neither.
    const ready = await prisma.position.findMany({
      where: {
        ...(o.absences
          ? {
              OR: [
                { status: "IN_REVIEW" },
                {
                  status: "DRAFT",
                  stance: { in: ["NO_STATED_POSITION", "DECLINED_TO_STATE"] },
                  candidate: { sources: { some: { NOT: { text: "" } } } },
                },
              ],
            }
          : { status: "IN_REVIEW" }),
        NOT: { propositionId: null },
        ...(o.election
          ? { candidate: { candidacies: { some: { race: { election: { slug: o.election } } } } } }
          : {}),
      },
      include: { candidate: { select: { fullName: true } }, issue: { select: { slug: true } }, evidence: true },
      ...(o.limit ? { take: o.limit } : {}),
    });

    console.log(`${ready.length} positions ready`);
    let published = 0;
    const refused: string[] = [];

    // Absences are numerous by nature — a candidate who addresses three issues is
    // silent on seventeen — so they go in batches. Same checks, one decision.
    const absences = ready.filter(
      (p) => p.stance === "NO_STATED_POSITION" || p.stance === "DECLINED_TO_STATE",
    );
    const stated = ready.filter((p) => !absences.includes(p));

    for (let i = 0; i < absences.length; i += 500) {
      const batch = absences.slice(i, i + 500);
      if (o.dryRun) { published += batch.length; continue; }
      const res = await fetch(`${o.api}/admin/positions/publish-batch`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "x-reviewer": o.reviewer,
        },
        body: JSON.stringify({ ids: batch.map((p) => p.id) }),
      });
      if (res.ok) {
        const r = (await res.json()) as { published: number; refused: Array<{ why: string }> };
        published += r.published;
        for (const x of r.refused.slice(0, 3)) refused.push(`batch: ${x.why}`);
      } else {
        refused.push(`batch of ${batch.length}: ${res.status}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
      process.stderr.write(`  absences ${Math.min(i + 500, absences.length)}/${absences.length}\n`);
    }

    for (const p of stated) {
      // The API refuses a stance with no evidence. Checking here too so the reason is
      // visible in this output rather than only as a 422.
      const isAbsence = p.stance === "NO_STATED_POSITION" || p.stance === "DECLINED_TO_STATE";
      if (!isAbsence && p.evidence.length === 0) {
        refused.push(`${p.candidate?.fullName} · ${p.issue.slug}: no evidence`);
        continue;
      }
      if (o.dryRun) { published++; continue; }

      // The API rate-limits, correctly — it is a public service and a client that
      // ignores that is the problem. Back off rather than raising the limit.
      let res: Response | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        res = await fetch(`${o.api}/admin/positions/${p.id}/publish`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "x-reviewer": o.reviewer },
        });
        if (res.status !== 429) break;
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      }
      if (res?.ok) published++;
      else refused.push(`${p.candidate?.fullName} · ${p.issue.slug}: ${res?.status} ${((await res?.text()) ?? "").slice(0, 120)}`);
    }

    console.log(`${published} published, ${refused.length} refused${o.dryRun ? "  (dry run)" : ""}`);
    for (const r of refused.slice(0, 10)) console.log(`  ! ${r}`);
    await prisma.$disconnect();
  });

program
  .command("map-bills")
  .description("Decide what a vote on each bill means for each proposition. One judgment per bill.")
  .option("--limit <n>", "bills to classify", (v) => Number(v))
  .option("--dry-run")
  .action(async (o) => {
    const bills = await prisma.voteRecord.groupBy({ by: ["billId"] });
    const propositions = await prisma.proposition.findMany({
      where: { isCurrent: true },
      include: { issue: { select: { slug: true } } },
    });

    // Skip bills already decided. A confirmed mapping is not re-litigated by a model.
    const done = new Set(
      (await prisma.billProposition.findMany({ select: { billId: true } })).map((b) => b.billId),
    );
    const todo = bills.map((b) => b.billId).filter((id) => !done.has(id)).slice(0, o.limit ?? 100);
    console.log(`${todo.length} bills to classify against ${propositions.length} propositions`);
    if (todo.length === 0) { await prisma.$disconnect(); return; }

    // The official CRS summary, never the title. Titles are written to persuade —
    // "Make the District of Columbia Safe and Beautiful Act" says nothing about what
    // the bill does — and reading them would launder a sponsor's framing into a
    // candidate's record.
    const key = process.env.CONGRESS_GOV_API_KEY;
    if (!key) throw new Error("CONGRESS_GOV_API_KEY is not set.");
    const fetched: BillInput[] = [];
    let noSummary = 0;
    for (const billId of todo) {
      const m = billId.match(/^([A-Z]+)\s+(\d+)$/);
      if (!m) continue;
      const type = m[1]!.toLowerCase();
      const num = m[2]!;
      const base = `https://api.congress.gov/v3/bill/119/${type}/${num}`;
      const [detail, summaries] = await Promise.all([
        fetch(`${base}?api_key=${key}&format=json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`${base}/summaries?api_key=${key}&format=json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const bill = (detail as { bill?: { title?: string; policyArea?: { name?: string } } })?.bill;
      const title = bill?.title ?? billId;
      const policyArea = bill?.policyArea?.name ?? null;
      const list = (summaries as { summaries?: Array<{ text?: string }> })?.summaries ?? [];
      const text = list.at(-1)?.text ?? "";
      const summary = text.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      // No summary means no basis. A title alone is not enough to decide what a vote
      // meant, and guessing from it is exactly the failure this is built to avoid.
      if (summary.length < 80) { noSummary++; continue; }
      fetched.push({ billId, title, summary, policyArea });
    }
    console.log(`${fetched.length} have an official summary, ${noSummary} do not and are skipped`);

    const report = await proposeMappings(
      fetched,
      propositions.map((p) => ({ id: p.id, issueSlug: p.issue.slug, text: p.text, yesMeans: p.yesMeans, noMeans: p.noMeans })),
      { dryRun: !!o.dryRun },
    );

    console.log(`\n${report.pairsChecked} bill x proposition pairs checked · ${report.proposed} mappings proposed · ${report.costCents.toFixed(2)}c`);
    for (const d of report.details) {
      console.log(`  ${d.billId} -> ${d.issueSlug}: a Yea means ${d.yeaMeans}`);
      console.log(`     ${d.reasoning.slice(0, 180)}`);
    }
    console.log(
      `\nAll PROPOSED. Nothing becomes a position until a person confirms it — this is ` +
        `the one point where a recorded fact becomes an interpreted claim.`,
    );
    await prisma.$disconnect();
  });

program
  .command("verify-bills")
  .description("Try to refute each proposed bill mapping. Confirms only the ones that survive.")
  .option("--dry-run")
  .action(async (o) => {
    const r = await verifyMappings({ dryRun: !!o.dryRun });
    console.log(`checked ${r.checked} · confirmed ${r.upheld} · refuted ${r.refuted} · ${r.costCents.toFixed(2)}c`);
    for (const x of r.rejections) {
      console.log(`\n  REFUTED ${x.billId} -> ${x.issueSlug}`);
      console.log(`     ${x.reason.slice(0, 320)}`);
    }
    await prisma.$disconnect();
  });

program
  .command("verify")
  .description("Re-check every draft position against its quote alone. Rejects the ones that do not hold up.")
  .option("--election <slug>")
  .option("--limit <n>", "cap positions checked", (v) => Number(v))
  .option("--model <id>", "verifier model", VERIFY_MODEL)
  .option("--dry-run")
  .action(async (o) => {
    const r = await runVerification({
      ...(o.election ? { electionSlug: o.election } : {}),
      ...(o.limit ? { limit: o.limit } : {}),
      model: o.model,
      dryRun: !!o.dryRun,
    });

    console.log(`checked ${r.checked} · upheld ${r.upheld} · rejected ${r.rejected} · ${r.costCents.toFixed(2)}c`);
    console.log("\nwhy rejected:");
    for (const [k, v] of Object.entries(r.failures).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(20)} ${v}`);
    }

    // The number this whole pass exists to expose.
    console.log(`\nsupport:oppose before  ${directionRatio(r.before)}`);
    console.log(`support:oppose after   ${directionRatio(r.after)}`);
    console.log("\nbefore:", JSON.stringify(r.before));
    console.log("after: ", JSON.stringify(r.after));

    if (r.examples.length) {
      console.log("\nrejected examples:");
      for (const e of r.examples.slice(0, 12)) {
        console.log(`  [${e.failure}] ${e.candidate} · ${e.issue} · was ${e.was}`);
        console.log(`     "${e.quote}"`);
        console.log(`     ${e.reason}`);
      }
    }
    if (r.errors.length) {
      console.log("\nerrors:");
      for (const e of r.errors) console.log(`  ! ${e}`);
    }
    if (o.dryRun) console.log("\n(dry run, nothing written)");
    await prisma.$disconnect();
  });

program
  .command("fidelity")
  .description("Phase 0: score the extractor against the archived candidate pages. Writes nothing to the DB.")
  .option("--dir <path>", "archive directory", "docs/phase0")
  .option("--out <path>", "where to write the results", "docs/PHASE0_RESULTS.md")
  .action(async (o) => {
    const slugs = ["chad-west", "jeff-kitner", "bill-roth", "paula-blackmon", "adam-bazaldua"];
    const docs = loadArchive(o.dir, slugs);
    const issueSlugs = await cityIssueSlugs();

    const labelSets = new Map<string, LabelSet>();
    labelSets.set("drafted", loadProposedLabels(`${o.dir}/proposed-labels.json`, docs));
    for (const [name, file] of [
      ["commitment", `${o.dir}/independent-commitment.json`],
      ["voter", `${o.dir}/independent-voter.json`],
    ] as const) {
      const abs = fromRepoRoot(file);
      if (existsSync(abs)) labelSets.set(name, loadLabelsBySlug(JSON.parse(readFileSync(abs, "utf8"))));
    }

    console.log(
      `${docs.length} documents · ${issueSlugs.length} issues · ` +
        `${labelSets.size} label set(s): ${[...labelSets.keys()].join(", ")}`,
    );

    const run = await runExtractors(docs, issueSlugs);
    const report = score(run.cells, labelSets);

    const quoteValidity =
      run.quotesOffered === 0 ? 100 : (100 * (run.quotesOffered - run.rejected.length)) / run.quotesOffered;
    const p = (n: number) => `${n.toFixed(1)}%`;

    console.log(`\nquote validity      ${p(quoteValidity)}  (${run.rejected.length} of ${run.quotesOffered} rejected)`);
    console.log(`stance agreement    ${p(report.exactAgreement)} exact · ${p(report.directionAgreement)} same direction`);
    console.log(`  scored on ${report.scoredRows} rows; ${report.contestedRows} contested between readers`);
    for (const [m, v] of Object.entries(report.modelAgreement)) console.log(`  ${m.padEnd(20)} ${p(v)}`);
    console.log(`absence accuracy    ${p(report.absenceAccuracy)} of ${report.absenceRows} silent rows`);
    console.log(`false absence       ${p(report.falseAbsence)} of ${report.statedRows} stated rows`);
    console.log(`false presence      ${p(report.falsePresence)} of ${report.absenceRows} silent rows`);
    console.log(`wrong answers       ${report.wrongAnswers} of ${report.scoredRows} scored rows`);
    console.log(`model disagreement  ${report.flaggedRows} rows produced no answer`);
    console.log(`cost                ${run.costCents.toFixed(2)}c total · ${(run.costCents / docs.length).toFixed(2)}c per candidate`);

    writeFileSync(fromRepoRoot(o.out), renderResults({ docs, issueSlugs, run, report, quoteValidity, labelSets }));
    console.log(`\nwrote ${o.out}`);
    await prisma.$disconnect();
  });

/** The results document. Written by the harness so the numbers cannot drift from the run. */
function renderResults(x: {
  docs: Array<{ slug: string; candidate: string; url: string; chars: number }>;
  issueSlugs: string[];
  run: Awaited<ReturnType<typeof runExtractors>>;
  report: ReturnType<typeof score>;
  quoteValidity: number;
  labelSets: Map<string, LabelSet>;
}): string {
  const p = (n: number) => `${n.toFixed(1)}%`;
  const names = [...x.labelSets.keys()];
  const L: string[] = [];

  L.push("# Phase 0 fidelity test — results");
  L.push("");
  L.push("Generated by `pnpm extract fidelity`. Do not edit by hand: rerun it.");
  L.push("");
  L.push("## What these numbers are, and are not");
  L.push("");
  L.push(
    "The labels scored against here were written by **models**, not by a person. Three readers " +
      "with three different rubrics, none of which had seen the extractor prompt. That measures " +
      "whether independently instructed readers converge on the same answer. It does **not** " +
      "establish that the answer is right, and it should not be quoted as if it did.",
  );
  L.push("");
  L.push(
    "Quote validity is the exception and is worth more than the rest: a quote either is a span " +
      "of the archived document or it is not. No judgment is involved.",
  );
  L.push("");
  L.push("## Headline");
  L.push("");
  L.push("| Measure | Value | Judgment involved |");
  L.push("|---|---|---|");
  L.push(`| Quote validity | **${p(x.quoteValidity)}** (${x.run.rejected.length}/${x.run.quotesOffered} rejected) | none |`);
  L.push(`| Stance agreement, exact | ${p(x.report.exactAgreement)} | yes |`);
  L.push(`| Stance agreement, direction only | ${p(x.report.directionAgreement)} | yes |`);
  L.push(`| Absence accuracy | ${p(x.report.absenceAccuracy)} of ${x.report.absenceRows} silent rows | little |`);
  L.push(`| False absence — said silent, readers saw a stance | ${p(x.report.falseAbsence)} of ${x.report.statedRows} stated rows | little |`);
  L.push(`| **False presence — asserted a stance the readers did not see** | **${p(x.report.falsePresence)} of ${x.report.absenceRows} silent rows** | little |`);
  L.push(`| Wrong answers (excludes rows it declined to answer) | ${x.report.wrongAnswers} of ${x.report.scoredRows} | yes |`);
  L.push(`| Rows with no answer (models disagreed) | ${x.report.flaggedRows} | none |`);
  L.push(`| Rows contested between readers | ${x.report.contestedRows} of ${x.report.rows.length} | — |`);
  L.push(`| Cost per candidate | ${(x.run.costCents / x.docs.length).toFixed(2)}c | none |`);
  L.push("");
  L.push("Per model, against the readers' consensus:");
  L.push("");
  L.push("| Model | Exact agreement |");
  L.push("|---|---|");
  for (const [m, v] of Object.entries(x.report.modelAgreement)) L.push(`| \`${m}\` | ${p(v)} |`);
  L.push("");

  L.push("## Documents");
  L.push("");
  L.push("| Candidate | Chars | Page |");
  L.push("|---|---|---|");
  for (const d of x.docs) L.push(`| ${d.candidate} | ${d.chars} | ${d.url} |`);
  L.push("");

  const contested = x.report.rows.filter((r) => r.consensus === null);
  L.push(`## Contested rows — ${contested.length}`);
  L.push("");
  L.push(
    "The readers did not agree with each other here, so there is nothing to score against. " +
      "These, and only these, are worth a person's time.",
  );
  L.push("");
  L.push(`| Candidate | Issue | ${names.join(" | ")} | Extractor |`);
  L.push(`|---|---|${names.map(() => "---").join("|")}|---|`);
  for (const r of contested) {
    L.push(
      `| ${r.slug} | \`${r.issueSlug}\` | ${names.map((n) => r.labels[n] ?? "—").join(" | ")} | ${r.pipeline} |`,
    );
  }
  L.push("");

  const missed = x.report.rows.filter((r) => r.consensus !== null && !r.exact);
  L.push(`## Where the extractor disagreed with an agreed label — ${missed.length}`);
  L.push("");
  L.push("| Candidate | Issue | Readers agreed | Extractor | Same direction |");
  L.push("|---|---|---|---|---|");
  for (const r of missed) {
    L.push(
      `| ${r.slug} | \`${r.issueSlug}\` | ${r.consensus} | ${r.pipeline} | ${r.sameDirection ? "yes" : "no"} |`,
    );
  }
  L.push("");

  if (x.run.rejected.length) {
    L.push("## Quotes rejected by the verbatim gate");
    L.push("");
    L.push("| Candidate | Issue | Reason |");
    L.push("|---|---|---|");
    for (const r of x.run.rejected) {
      L.push(`| ${r.slug} | \`${r.issueSlug}\` | ${r.reason} |`);
      if (r.quote) L.push(`| | | offered: ${JSON.stringify(r.quote.slice(0, 220))} |`);
    }
    L.push("");
  }

  L.push("## Full grid");
  L.push("");
  L.push(`| Candidate | Issue | ${names.join(" | ")} | model A | model B | pipeline |`);
  L.push(`|---|---|${names.map(() => "---").join("|")}|---|---|---|`);
  for (const r of x.report.rows) {
    const cell = (s: string) => (s === ABSENT ? "—" : s);
    L.push(
      `| ${r.slug} | \`${r.issueSlug}\` | ${names.map((n) => cell(r.labels[n] ?? "?")).join(" | ")} | ` +
        `${cell(r.a)} | ${cell(r.b)} | ${cell(r.pipeline)} |`,
    );
  }
  L.push("");
  return L.join("\n");
}

program.parseAsync();
