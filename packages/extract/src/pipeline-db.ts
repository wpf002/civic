/**
 * The extraction pipeline, wired to the database.
 *
 * For each unprocessed Source: run two independent models, reconcile, and write
 * DRAFT positions where they agree and ReviewTasks where they do not. Nothing here
 * publishes — a person does that in the review console.
 *
 * Two rules are enforced structurally rather than by intention:
 *
 * 1. No model output reaches Evidence.quote. `findVerbatim` returns the span from
 *    the archived source text and that span is what gets stored, so a stored quote
 *    is a byte-exact slice of the document by construction.
 *
 * 2. A position on a PUBLISHED row is never updated. If a source is re-extracted and
 *    the candidate already has a published position for that issue, this writes
 *    nothing and opens a ReviewTask instead — a correction is a new row with
 *    supersedesId, made by a human.
 */
import { findVerbatim, type ExtractedPosition } from "@civic/core";
import { prisma } from "@civic/db";
import { EXTRACT_SYSTEM } from "./prompts/extract-positions.js";
import { MODEL_A, MODEL_B, ModelRefusalError, inputCentsFor, type CompleteFn } from "./llm.js";
import { extractOnce, reconcile, renderInput } from "./pipeline.js";

/**
 * What a run may spend when nobody said otherwise, in cents.
 *
 * This is the floor for every entry point, not just the CLI's flag default, so
 * that forgetting a budget costs $5 rather than the account balance. Raise it
 * per run with --max-cost; pass null in code to opt out deliberately.
 */
export const DEFAULT_MAX_COST_CENTS = 500;

/** Thrown to stop a run dead rather than repeat a failure hundreds of times. */
export class FatalRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalRunError";
  }
}

export interface RunOptions {
  /** Limit to one source. */
  sourceId?: string;
  /** Limit to one candidate's sources. */
  candidateSlug?: string;
  /**
   * Limit to one election.
   *
   * Absent, this walks EVERY source in the database. A run meant for 84 North
   * Carolina pages processed 466 sources and spent the budget on Texas pages that
   * had already been extracted, then ran out before reaching North Carolina.
   */
  electionSlug?: string;
  /**
   * Re-extract sources that already produced positions. Off by default.
   *
   * The same source read twice by the same models costs the same and produces the
   * same answer.
   */
  force?: boolean;
  /**
   * Stop once the run has spent this many cents. Omit it and you get
   * DEFAULT_MAX_COST_CENTS — a forgotten budget must not mean an unlimited one.
   * Pass `null` to run uncapped, which has to be a decision someone typed.
   */
  maxCostCents?: number | null;
  /** Cap how many sources are processed in a run. */
  limit?: number;
  /**
   * Which offices' candidates to read. "top" is federal, governor and statewide;
   * "legislature" is state senate and house. Absent, both. Kept apart because they
   * are approved and paid for separately.
   */
  tier?: "top" | "legislature";
  /** Only candidates certified to a ballot, never filers who lost a primary. */
  certifiedOnly?: boolean;
  modelA?: string;
  modelB?: string;
  dryRun?: boolean;
  /**
   * How many sources to process at once.
   *
   * Was effectively 1: the two models ran in parallel with each other, but source
   * two waited for source one. Fine at 59 sources, 83 minutes at 311.
   */
  concurrency?: number;
  /** Called after each source, so a long run says where it is. */
  onProgress?: (done: number, total: number, label: string) => void;
  /** Injectable so tests never call a model. */
  complete?: CompleteFn;
}

export interface RunReport {
  extractRunId: string | null;
  sources: number;
  drafts: number;
  flagged: number;
  rejectedQuotes: number;
  refusals: number;
  costCents: number;
  details: Array<{
    sourceUrl: string;
    candidate: string | null;
    agreed: string[];
    flagged: string[];
    rejected: string[];
    error?: string;
  }>;
}

/**
 * What a run would cost, without spending anything.
 *
 * Uses this project's own measured rate rather than a token estimate: cost per
 * source is dominated by how many propositions a document addresses, which no
 * counting of input tokens predicts. The rate comes from completed ExtractRun rows,
 * so it tracks the real cost as prompts and models change, and falls back to the
 * last measured figure when there is no history.
 */
const LEGISLATURE = ["State Senator", "State Representative"];

/** The sources a run with these options would read. One definition for the run and its quote. */
export function sourceScope(opts: RunOptions) {
  const candidacy =
    opts.electionSlug || opts.tier || opts.certifiedOnly
      ? {
          candidacies: {
            some: {
              ...(opts.electionSlug ? { race: { election: { slug: opts.electionSlug } } } : {}),
              ...(opts.tier
                ? {
                    race: {
                      ...(opts.electionSlug ? { election: { slug: opts.electionSlug } } : {}),
                      office: { title: opts.tier === "legislature" ? { in: LEGISLATURE } : { notIn: LEGISLATURE } },
                    },
                  }
                : {}),
              ...(opts.certifiedOnly ? { isCertified: true } : {}),
            },
          },
        }
      : {};
  return {
    ...(opts.sourceId ? { id: opts.sourceId } : {}),
    ...(opts.candidateSlug || Object.keys(candidacy).length
      ? { candidate: { ...(opts.candidateSlug ? { slug: opts.candidateSlug } : {}), ...candidacy } }
      : {}),
    ...(opts.force ? {} : { extractedAt: null }),
    NOT: { text: "" },
  };
}

export async function estimateRunCost(
  opts: RunOptions = {},
): Promise<{ sources: number; centsPerSource: number; totalCents: number; basedOn: string }> {
  const sources = await prisma.source.count({ where: sourceScope(opts) });

  // Runs of a handful of sources are test fixtures and one-off probes, and their
  // rounded whole-cent costs make the rate look an order of magnitude too low. A real
  // run reads more than five documents.
  const history = await prisma.extractRun.findMany({
    where: { finishedAt: { not: null }, costCents: { gt: 0 }, sourceCount: { gte: 5 } },
    orderBy: { startedAt: "desc" },
    take: 5,
    select: { costCents: true, sourceCount: true },
  });

  // Averaging is wrong here. A run that aborted on an exhausted balance recorded a
  // large sourceCount and almost no cost, and averaging it in produced an estimate of
  // 1c per source against a real rate of 8. An estimate that under-reports invites
  // the surprise it exists to prevent, so this takes the highest recent rate and says
  // so. Rates below 1c are aborted runs and are dropped outright.
  const rates = history
    .map((r) => r.costCents / r.sourceCount)
    .filter((r) => r >= 1)
    .sort((a, b) => b - a);

  const measured = rates[0] ?? 8.4;

  return {
    sources,
    centsPerSource: measured,
    totalCents: sources * measured,
    basedOn: rates.length
      ? `the most expensive of ${rates.length} completed runs`
      : "the last measured rate",
  };
}

export async function runExtraction(opts: RunOptions = {}): Promise<RunReport> {
  // `??` not `||`, and resolved here rather than read off opts at the check:
  // the CLI has always defaulted this, but a caller that never mentions a
  // budget — a script, an agent, a REPL — used to get no cap at all. Runs on
  // 2026-09-09 spent $8.74 and $23.71 that way, hours after --max-cost was
  // added, because the default lived in the CLI instead of down here.
  const maxCostCents = opts.maxCostCents === undefined ? DEFAULT_MAX_COST_CENTS : opts.maxCostCents;
  const modelA = opts.modelA ?? MODEL_A;
  const modelB = opts.modelB ?? MODEL_B;
  if (modelA === modelB) {
    // Agreement between two samples of one model measures temperature, not truth.
    throw new Error(`the two extractor models must differ (both are ${modelA})`);
  }

  const issues = await prisma.issue.findMany({
    orderBy: { sortOrder: "asc" },
    include: { propositions: { where: { isCurrent: true }, take: 1 } },
  });

  // An issue with no live proposition has no question to answer, so it is skipped
  // rather than extracted against its topic name.
  const missing = issues.filter((i) => i.propositions.length === 0).map((i) => i.slug);
  if (missing.length) {
    console.warn(
      `skipping ${missing.length} issue(s) with no current proposition: ${missing.join(", ")}`,
    );
  }

  const sources = await prisma.source.findMany({
    // A source that has been read is not read again (extractedAt), and only sources we
    // have text for: a source we could not archive cannot be quoted. See sourceScope.
    where: sourceScope(opts),
    include: { candidate: true },
    orderBy: { capturedAt: "asc" },
    ...(opts.limit ? { take: opts.limit } : {}),
  });

  const report: RunReport = {
    extractRunId: null,
    sources: sources.length,
    drafts: 0,
    flagged: 0,
    rejectedQuotes: 0,
    refusals: 0,
    costCents: 0,
    details: [],
  };

  const run = opts.dryRun
    ? null
    : await prisma.extractRun.create({
        data: { models: [modelA, modelB], sourceCount: sources.length },
      });
  report.extractRunId = run?.id ?? null;

  // Sources are independent: each is one document, and nothing one produces changes
  // how another is read. Processing them one at a time was costing an hour per run.
  const queue = [...sources];
  let done = 0;

  let fatal: FatalRunError | null = null;

  const worker = async () => {
    for (;;) {
      if (fatal) return;
      // A budget is a stop, not a warning. Without it a mistyped command spends
      // whatever is in the account.
      if (maxCostCents != null && report.costCents >= maxCostCents) {
        fatal ??= new FatalRunError(
          `stopped at ${report.costCents.toFixed(2)}c, the --max-cost limit. ` +
            `${queue.length} sources were not processed.`,
        );
        return;
      }
      const source = queue.shift();
      if (!source) return;

      if (!source.candidateId) {
        report.details.push({
          sourceUrl: source.url,
          candidate: null,
          agreed: [],
          flagged: [],
          rejected: [],
          error: "source is not linked to a candidate; extraction needs to know whose words these are",
        });
        // A skipped source is still a source that has been dealt with. Without this
        // the progress count drifts below the total and the estimate never reaches
        // zero, which reads as a hung run.
        done++;
        opts.onProgress?.(done, sources.length, source.url);
        continue;
      }

      // Only issues that apply to an office this candidate is running for. Extracting a
      // school-board candidate's housing position invents a question nobody asked.
      const levels = new Set(
        (
          await prisma.candidacy.findMany({
            where: { candidateId: source.candidateId },
            include: { race: { include: { office: { include: { jurisdiction: true } } } } },
          })
        ).map((c) => c.race.office.jurisdiction.level),
      );
      const applicable = issues.filter(
        (i) => i.levels.some((l) => levels.has(l)) && i.propositions.length > 0,
      );
      const issueSlugs = applicable.map((i) => i.slug);
      if (issueSlugs.length === 0) {
        done++;
        opts.onProgress?.(done, sources.length, source.candidate?.fullName ?? source.url);
        continue;
      }
      const propositions = applicable.map((i) => ({
        issueSlug: i.slug,
        text: i.propositions[0]!.text,
        yesMeans: i.propositions[0]!.yesMeans,
        noMeans: i.propositions[0]!.noMeans,
      }));
      const propositionByIssue = new Map(applicable.map((i) => [i.slug, i.propositions[0]!.id]));

      const detail: RunReport["details"][number] = {
        sourceUrl: source.url,
        candidate: source.candidate?.fullName ?? null,
        agreed: [],
        flagged: [],
        rejected: [],
      };

      try {
        const input = { sourceText: source.text, issueSlugs, propositions };
        const [a, b] = await Promise.all([
          extractOnce(input, modelA, opts.complete),
          extractOnce(input, modelB, opts.complete),
        ]);
        report.costCents += a.costCents + b.costCents;
        report.rejectedQuotes += a.rejected.length + b.rejected.length;
        detail.rejected = [...a.rejected, ...b.rejected].map(
          (r) => `${r.position.issueSlug}: ${r.reason}`,
        );

        const { agreed, flagged } = reconcile(a, b, issueSlugs);
        detail.agreed = agreed.map((p) => `${p.issueSlug}=${p.stance}`);
        detail.flagged = flagged.map((f) => `${f.issueSlug}[${f.a?.stance ?? "-"}/${f.b?.stance ?? "-"}]`);

        if (!opts.dryRun) {
          for (const p of agreed) {
            const wrote = await writeDraft(
              source,
              p,
              run!.id,
              `${modelA}+${modelB}`,
              propositionByIssue.get(p.issueSlug),
            );
            if (wrote) report.drafts++;
          }
          for (const f of flagged) {
            await prisma.reviewTask.create({
              data: {
                kind: "POSITION",
                targetId: source.id,
                reason:
                  `Model disagreement on "${f.issueSlug}" for ${source.candidate?.fullName ?? "unknown"}: ` +
                  `${modelA} said ${f.a?.stance ?? "nothing"}, ${modelB} said ${f.b?.stance ?? "nothing"}. ` +
                  `Source: ${source.url}`,
              },
            });
            report.flagged++;
          }
        } else {
          report.drafts += agreed.length;
          report.flagged += flagged.length;
        }
      } catch (err) {
        if (err instanceof ModelRefusalError) {
          report.refusals++;
          detail.error = `declined (${err.category ?? "unspecified"})`;
          if (!opts.dryRun) {
            await prisma.reviewTask.create({
              data: {
                kind: "SOURCE_FLAG",
                targetId: source.id,
                reason: `A model declined to process ${source.url}: ${err.message}`,
              },
            });
          }
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          detail.error = msg;
          // An exhausted balance, a bad key or a revoked key fails identically for
          // every remaining source. Repeating it once per source produced hundreds of
          // identical log lines and no work.
          if (/credit balance|authentication_error|invalid x-api-key|permission_error/i.test(msg)) {
            fatal ??= new FatalRunError(`stopped: ${msg.slice(0, 200)}`);
            report.details.push(detail);
            return;
          }
        }
      }

      // Marked read whether or not it produced anything. A document that says nothing
      // has still been read, and reading it again will still find nothing.
      if (!opts.dryRun && !detail.error) {
        await prisma.source.update({
          where: { id: source.id },
          data: { extractedAt: new Date(), extractRunId: run!.id },
        });
      }

      report.details.push(detail);
      done++;
      opts.onProgress?.(done, sources.length, source.candidate?.fullName ?? source.url);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency ?? 6, sources.length) }, worker),
  );

  if (fatal) {
    if (run) {
      await prisma.extractRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          draftCount: report.drafts,
          flaggedCount: report.flagged,
          costCents: Math.round(report.costCents),
        },
      });
    }
    throw fatal;
  }

  if (run) {
    await prisma.extractRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        draftCount: report.drafts,
        flaggedCount: report.flagged,
        costCents: Math.round(report.costCents),
      },
    });
  }

  return report;
}

/** Returns false when a published row already exists — corrections are a human act. */
async function writeDraft(
  source: { id: string; candidateId: string | null; text: string; url: string },
  p: ExtractedPosition,
  extractRunId: string,
  extractedBy: string,
  propositionId?: string,
): Promise<boolean> {
  const issue = await prisma.issue.findUnique({ where: { slug: p.issueSlug } });
  if (!issue || !source.candidateId) return false;

  const isAbsenceDraft = p.stance === "NO_STATED_POSITION" || p.stance === "DECLINED_TO_STATE";

  // Extraction runs once per SOURCE, but a position belongs to a candidate and a
  // question. Without this, a candidate with nine archived pages got nine "no stated
  // position" rows for the same question, and publishing put all nine live — 2,038
  // questions with several live answers before this was caught.
  //
  // An absence is only worth recording once, and only if nothing is known yet: silence
  // on this page does not contradict a stance found on another. A stance is recorded
  // unless the same stance is already pending or live.
  const known = await prisma.position.findMany({
    where: {
      candidateId: source.candidateId,
      issueId: issue.id,
      status: { in: ["DRAFT", "IN_REVIEW", "PUBLISHED"] },
    },
    select: { stance: true, status: true },
  });
  if (isAbsenceDraft && known.length > 0) return false;
  if (!isAbsenceDraft && known.some((k) => k.stance === p.stance && k.status !== "PUBLISHED")) return false;

  const existing = await prisma.position.findFirst({
    where: { candidateId: source.candidateId, issueId: issue.id, status: "PUBLISHED" },
  });
  // A published absence is what a stance found on a later page is supposed to
  // replace, so it does not block drafting. The publish step supersedes it.
  const blocking =
    existing &&
    !["NO_STATED_POSITION", "DECLINED_TO_STATE"].includes(existing.stance)
      ? existing
      : null;
  if (blocking) {
    // Never update a published row. A change is a new row with supersedesId, decided
    // by a person in the review console.
    await prisma.reviewTask.create({
      data: {
        kind: "POSITION",
        targetId: blocking.id,
        reason:
          `Re-extraction of ${source.url} produced ${p.stance} for "${p.issueSlug}", but a ` +
          `published position already exists. A correction must supersede, not overwrite.`,
      },
    });
    return false;
  }

  const isAbsence = p.stance === "NO_STATED_POSITION" || p.stance === "DECLINED_TO_STATE";
  let evidenceId: string | undefined;

  if (!isAbsence) {
    // The gate. The stored quote is the source's own span, never the model's string.
    const match = findVerbatim(source.text, p.quote);
    if (!match) return false;
    const ev = await prisma.evidence.create({
      data: {
        sourceId: source.id,
        quote: match.quote,
        startOffset: match.start,
        endOffset: match.end,
      },
    });
    evidenceId = ev.id;
  }

  await prisma.position.create({
    data: {
      candidateId: source.candidateId,
      issueId: issue.id,
      stance: p.stance,
      summary: p.summary,
      confidence: p.confidence,
      status: "DRAFT",
      extractedBy,
      extractRunId,
      ...(propositionId ? { propositionId } : {}),
      ...(evidenceId ? { evidence: { connect: { id: evidenceId } } } : {}),
    },
  });
  return true;
}


/**
 * What a run will cost, with the input side counted exactly.
 *
 * Every source's request is sent to the free token-counting endpoint for both models,
 * so the input cost is the real figure. Output cannot be counted before it is written,
 * so it comes from the most recent real run: that run's own sources are counted the
 * same way, the input subtracted from what it actually cost, and the remainder divided
 * by its sources. Verification is added at the rate the last verify pass measured.
 */
export async function exactRunCost(
  opts: RunOptions,
  count: (req: { model: string; system: string; input: string }) => Promise<number>,
  onProgress?: (done: number, total: number) => void,
): Promise<{
  sources: number;
  inputTokens: { a: number; b: number };
  inputCents: number;
  outputCents: number;
  verifyCents: number;
  totalCents: number;
  outputBasis: string;
}> {
  const modelA = opts.modelA ?? MODEL_A;
  const modelB = opts.modelB ?? MODEL_B;
  const issues = await prisma.issue.findMany({
    orderBy: { sortOrder: "asc" },
    include: { propositions: { where: { isCurrent: true }, take: 1 } },
  });
  const live = issues.filter((i) => i.propositions.length > 0);
  const propositions = live.map((i) => ({
    issueSlug: i.slug,
    text: i.propositions[0]!.text,
    yesMeans: i.propositions[0]!.yesMeans,
    noMeans: i.propositions[0]!.noMeans,
  }));
  const issueSlugs = live.map((i) => i.slug);

  const tokensFor = async (texts: string[], tick?: () => void) => {
    let a = 0;
    let b = 0;
    const queue = [...texts];
    const worker = async () => {
      for (;;) {
        const text = queue.shift();
        if (text === undefined) return;
        const input = renderInput({ sourceText: text, issueSlugs, propositions });
        a += await count({ model: modelA, system: EXTRACT_SYSTEM, input });
        b += await count({ model: modelB, system: EXTRACT_SYSTEM, input });
        tick?.();
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return { a, b };
  };

  const sources = await prisma.source.findMany({ where: sourceScope(opts), select: { text: true } });
  let done = 0;
  const inputTokens = await tokensFor(sources.map((s) => s.text), () => onProgress?.(++done, sources.length));
  const inputCents = inputCentsFor(modelA, inputTokens.a) + inputCentsFor(modelB, inputTokens.b);

  // Output, calibrated on the most recent real run that recorded its sources.
  const reference = await prisma.extractRun.findFirst({
    where: { finishedAt: { not: null }, costCents: { gt: 0 }, sourceCount: { gte: 20 } },
    orderBy: { startedAt: "desc" },
  });
  let outputPerSource = 0;
  let outputBasis = "no reference run; output not estimated";
  if (reference) {
    const refSources = await prisma.source.findMany({ where: { extractRunId: reference.id }, select: { text: true } });
    if (refSources.length > 0) {
      const refTokens = await tokensFor(refSources.map((s) => s.text));
      const refInput = inputCentsFor(modelA, refTokens.a) + inputCentsFor(modelB, refTokens.b);
      outputPerSource = Math.max(0, reference.costCents - refInput) / refSources.length;
      outputBasis = `run of ${refSources.length} sources on ${reference.startedAt.toISOString().slice(0, 10)}: ${reference.costCents}c, of which ${refInput.toFixed(0)}c input`;
    }
  }
  const outputCents = outputPerSource * sources.length;
  // Measured: the North Carolina verify pass cost 39.90c for the 82 sources that run read.
  const verifyCents = (39.9 / 82) * sources.length;

  return {
    sources: sources.length,
    inputTokens,
    inputCents,
    outputCents,
    verifyCents,
    totalCents: inputCents + outputCents + verifyCents,
    outputBasis,
  };
}
