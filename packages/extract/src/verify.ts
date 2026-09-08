/**
 * Adversarial review of draft positions.
 *
 * The extractor proposes; this disposes. A third model call, independent of both
 * extractors, is shown ONLY the issue, the stance claimed, and the verbatim quote —
 * never the extractor's summary or reasoning — and asked whether the quote alone
 * establishes that stance. If it does not, the position is rejected with a reason.
 *
 * Three things this is built to catch, all of them observed in real runs:
 *
 *   slogan inflation   "ensuring development benefits our residents" read as a
 *                      zoning position. The Phase 0 test caught exactly this and it
 *                      is the failure mode that matters most: inventing a stance is
 *                      worse than missing one, because the product presents what it
 *                      has as findings.
 *   wrong issue        a quote about police pay filed under criminal justice.
 *   direction collapse "I oppose raising taxes" scored as SUPPORT because the
 *                      sentence is enthusiastic. 138 supporting stances against 7
 *                      opposing ones in the first real run is either how candidates
 *                      write or a bias in the reader, and this is how we find out.
 *
 * The verifier is deliberately asked to be strict and to default to rejecting when
 * it is unsure. A position that survives is one where a reader who saw nothing but
 * the candidate's own words agreed. That is the standard the product claims.
 */
import { z } from "zod";
import { prisma } from "@civic/db";
import { MODEL_A, MODEL_B, ModelRefusalError, complete, type CompleteFn } from "./llm.js";

/** A verifier that is one of the extractors is grading its own work. */
export const VERIFY_MODEL = process.env.VERIFY_MODEL ?? MODEL_A;

export const VerdictSchema = z.object({
  /** Does the quote, on its own, establish this stance on this issue? */
  upheld: z.boolean(),
  /**
   * Why not. One of a fixed set so the failures can be counted rather than read.
   */
  failure: z
    .enum([
      "NONE",
      "NOT_A_POSITION", // a slogan, a value, an accomplishment: no stated direction
      "WRONG_ISSUE", // says something real, but not about this issue
      "WRONG_DIRECTION", // the stance points the wrong way
      "WRONG_STRENGTH", // right direction, but the quote does not support the strength
      "QUOTE_INSUFFICIENT", // too fragmentary to establish anything
    ])
    .default("NONE"),
  /** The stance the verifier would assign instead, when it disagrees. */
  suggestedStance: z
    .enum([
      "STRONG_SUPPORT",
      "SUPPORT",
      "MIXED",
      "OPPOSE",
      "STRONG_OPPOSE",
      "NO_STATED_POSITION",
      "DECLINED_TO_STATE",
    ])
    .nullable()
    .default(null),
  // Was 400 and a third of verdicts blew past it, which threw inside the structured
  // parse and lost the verdict entirely. Same lesson as the extractor's summary cap:
  // a length limit enforced at the transport layer costs you the whole answer.
  reason: z.string().max(1200),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const VERIFY_SYSTEM = `You are auditing a claim about what a political candidate said. You have not seen
how the claim was produced and you must not try to infer it.

You are given: an issue, a stance that was assigned, and a quote taken verbatim from the candidate's own
archived document. Decide ONE thing: does that quote, read on its own, establish that stance on that issue?

Uphold only if a careful reader who saw nothing but this quote would agree. Default to NOT upholding when
you are unsure. Missing a real position costs a voter one line; asserting a position the candidate never
took misrepresents them, and that is the error that must not survive.

Apply these rules exactly.

1. A value, a slogan, or an accomplishment is not a position. "Ensuring development benefits our residents",
   "fighting for working families", "I secured $2M for our schools" state no direction on any policy
   question. Failure: NOT_A_POSITION.

2. The quote must answer THIS proposition, not a nearby question that shares a subject. This is the
   error that survived to publication most often, so weigh it hardest.

   "Invest in de-escalation training" does not answer "increase police funding above current
   levels" — training can be funded by reallocation. "Make mail-in voting easier" does not answer
   "allow any registered voter to vote by mail without giving a reason" — easier could mean more
   drop boxes. A quote that settles a related change, a broader goal, or a means toward the change
   has not settled the change itself.

   Ask: could a candidate agree with this quote and still disagree with the proposition? If yes,
   the quote does not establish the stance. Failure: WRONG_ISSUE.

3. Direction is decided by what the candidate would DO, not by the tone of the sentence. "I will fight to
   stop the tax increase" is OPPOSE on raising taxes, however energetic it sounds. Enthusiasm is not
   support. Be especially careful here: an affirmative sentence very often expresses opposition to
   something. Failure: WRONG_DIRECTION.

4. Strength is a commitment, not a volume. STRONG_SUPPORT and STRONG_OPPOSE require an unconditional
   commitment to act — "I will vote to X". A preference, a value, or a qualified statement is SUPPORT or
   OPPOSE. Failure: WRONG_STRENGTH.

5. MIXED is a real answer: the candidate supports part and opposes part.

6. If the quote is a fragment that cannot establish anything, say QUOTE_INSUFFICIENT.

Never use party, endorsements, the candidate's other statements, or what similar candidates believe. Only
the quote. You are not deciding whether the position is good, popular, or correct — only whether the
candidate stated it.`;

export interface VerifyOptions {
  electionSlug?: string;
  limit?: number;
  model?: string;
  dryRun?: boolean;
  complete?: CompleteFn;
  concurrency?: number;
}

export interface VerifyReport {
  checked: number;
  upheld: number;
  rejected: number;
  costCents: number;
  failures: Record<string, number>;
  /** Stance distribution before and after, so a directional bias is visible. */
  before: Record<string, number>;
  after: Record<string, number>;
  examples: Array<{ candidate: string; issue: string; was: string; failure: string; reason: string; quote: string }>;
  /** What actually went wrong, so an error count is never just a number. */
  errors: string[];
}

const tally = (rows: Array<{ stance: string }>) => {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.stance] = (out[r.stance] ?? 0) + 1;
  return out;
};

export async function runVerification(opts: VerifyOptions = {}): Promise<VerifyReport> {
  const model = opts.model ?? VERIFY_MODEL;
  const fn = opts.complete ?? complete;

  const drafts = await prisma.position.findMany({
    where: {
      status: "DRAFT",
      // Absences carry no quote, so there is nothing for this check to read. They are
      // audited separately, by re-reading the document rather than a span of it.
      stance: { notIn: ["NO_STATED_POSITION", "DECLINED_TO_STATE"] },
      ...(opts.electionSlug
        ? { candidate: { candidacies: { some: { race: { election: { slug: opts.electionSlug } } } } } }
        : {}),
    },
    include: {
      candidate: { select: { fullName: true } },
      issue: { select: { slug: true, name: true, description: true } },
      evidence: { select: { quote: true } },
    },
    orderBy: { capturedAt: "asc" },
    ...(opts.limit ? { take: opts.limit } : {}),
  });

  const report: VerifyReport = {
    checked: 0,
    upheld: 0,
    rejected: 0,
    costCents: 0,
    failures: {},
    before: tally(drafts),
    after: {},
    examples: [],
    errors: [],
  };

  const survivors: Array<{ stance: string }> = [];
  const queue = [...drafts];

  const worker = async () => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      const quote = p.evidence[0]?.quote;
      if (!quote) {
        // A stance with no evidence cannot be published anyway. Reject it here so it
        // stops occupying a reviewer's attention.
        if (!opts.dryRun) {
          await prisma.position.update({
            where: { id: p.id },
            data: { status: "REJECTED", reviewedBy: `verifier:${model}`, reviewedAt: new Date() },
          });
        }
        report.checked++;
        report.rejected++;
        report.failures.NO_EVIDENCE = (report.failures.NO_EVIDENCE ?? 0) + 1;
        continue;
      }

      try {
        const res = await fn({
          model,
          system: VERIFY_SYSTEM,
          input:
            `ISSUE: ${p.issue.name} (${p.issue.slug})\n` +
            `WHAT THIS ISSUE COVERS: ${p.issue.description}\n\n` +
            `STANCE ASSIGNED: ${p.stance}\n\n` +
            `QUOTE, verbatim from the candidate's own document:\n"""\n${quote}\n"""`,
          schema: VerdictSchema,
        });
        report.costCents += res.costCents;
        report.checked++;

        const v = res.output;
        if (v.upheld) {
          report.upheld++;
          survivors.push({ stance: p.stance });
          if (!opts.dryRun) {
            await prisma.position.update({
              where: { id: p.id },
              data: { status: "IN_REVIEW", reviewedBy: `verifier:${model}`, reviewedAt: new Date() },
            });
          }
          continue;
        }

        report.rejected++;
        report.failures[v.failure] = (report.failures[v.failure] ?? 0) + 1;
        if (report.examples.length < 25) {
          report.examples.push({
            candidate: p.candidate?.fullName ?? "unknown",
            issue: p.issue.slug,
            was: p.stance,
            failure: v.failure,
            reason: v.reason,
            quote: quote.slice(0, 160),
          });
        }
        if (!opts.dryRun) {
          await prisma.position.update({
            where: { id: p.id },
            data: { status: "REJECTED", reviewedBy: `verifier:${model}`, reviewedAt: new Date() },
          });
          // A rejection that suggests a different stance is a finding, not a deletion.
          // It goes to a person rather than being applied: the verifier is not allowed
          // to author a position, only to refuse one.
          if (v.suggestedStance && v.suggestedStance !== p.stance) {
            await prisma.reviewTask.create({
              data: {
                kind: "POSITION",
                targetId: p.id,
                reason:
                  `Verifier rejected ${p.stance} for ${p.candidate?.fullName ?? "unknown"} on ` +
                  `"${p.issue.slug}" (${v.failure}) and would assign ${v.suggestedStance}. ${v.reason}`,
              },
            });
          }
        }
      } catch (err) {
        if (err instanceof ModelRefusalError) {
          report.failures.REFUSED = (report.failures.REFUSED ?? 0) + 1;
        } else {
          report.failures.ERROR = (report.failures.ERROR ?? 0) + 1;
          const msg = err instanceof Error ? err.message : String(err);
          if (report.errors.length < 10) report.errors.push(msg.slice(0, 300));
        }
        report.checked++;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency ?? 6, queue.length) }, worker),
  );

  report.after = tally(survivors);
  return report;
}

/** The support/oppose ratio, which is what a directional bias shows up in. */
export function directionRatio(t: Record<string, number>): string {
  const s = (t.SUPPORT ?? 0) + (t.STRONG_SUPPORT ?? 0);
  const o = (t.OPPOSE ?? 0) + (t.STRONG_OPPOSE ?? 0);
  if (o === 0) return s === 0 ? "n/a" : `${s}:0`;
  return `${(s / o).toFixed(1)}:1`;
}
