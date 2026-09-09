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
import { MODEL_A, MODEL_B, ModelRefusalError, type CompleteFn } from "./llm.js";
import { extractOnce, reconcile } from "./pipeline.js";

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
  /** Stop once the run has spent this many cents. */
  maxCostCents?: number;
  /** Cap how many sources are processed in a run. */
  limit?: number;
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

export async function runExtraction(opts: RunOptions = {}): Promise<RunReport> {
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
    where: {
      ...(opts.sourceId ? { id: opts.sourceId } : {}),
      ...(opts.candidateSlug ? { candidate: { slug: opts.candidateSlug } } : {}),
      ...(opts.electionSlug
        ? { candidate: { candidacies: { some: { race: { election: { slug: opts.electionSlug } } } } } }
        : {}),
      // A source whose evidence already exists has been read. Reading it again costs
      // the same and produces the same answer.
      ...(opts.force ? {} : { evidence: { none: {} } }),
      // Only sources we have text for. A source we could not archive cannot be quoted.
      NOT: { text: "" },
    },
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
      if (opts.maxCostCents != null && report.costCents >= opts.maxCostCents) {
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
      if (issueSlugs.length === 0) continue;
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

        const { agreed, flagged } = reconcile(a, b);
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

  const existing = await prisma.position.findFirst({
    where: { candidateId: source.candidateId, issueId: issue.id, status: "PUBLISHED" },
  });
  if (existing) {
    // Never update a published row. A change is a new row with supersedesId, decided
    // by a person in the review console.
    await prisma.reviewTask.create({
      data: {
        kind: "POSITION",
        targetId: existing.id,
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
