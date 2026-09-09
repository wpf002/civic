/**
 * Measuring how often a PUBLISHED position is wrong.
 *
 * Phase 5's acceptance criterion, and the one that was skipped: 8,127 positions went
 * live on the strength of a verifier that ran before publication, and nobody has ever
 * measured the error rate of what is actually on the site. A verifier's own opinion
 * of its output is not a measurement — it is the same judgment, counted twice.
 *
 * This samples what is live, re-reads each one against its archived source, and
 * reports a rate with its sample size. Two things make it a measurement rather than
 * a second opinion:
 *
 *   The sample is random and drawn from PUBLISHED rows only, so it measures the
 *   product a voter sees rather than the queue.
 *   The auditor is given the source text, not just the quote, so it can catch a quote
 *   that is verbatim and still misrepresents the document around it — which the
 *   pre-publication verifier structurally cannot see.
 *
 * It changes nothing. An audit that also fixes what it finds cannot report a rate,
 * because the rate would describe a state that no longer exists.
 */
import { z } from "zod";
import { prisma } from "@civic/db";
import { MODEL_B, complete, type CompleteFn } from "./llm.js";

/** Deliberately the OTHER model. An auditor that is the verifier grades its own work. */
export const AUDIT_MODEL = process.env.AUDIT_MODEL ?? MODEL_B;

export const FindingSchema = z.object({
  correct: z.boolean(),
  fault: z
    .enum([
      "NONE",
      "QUOTE_NOT_IN_SOURCE", // the gate failed, which should be impossible
      "QUOTE_OUT_OF_CONTEXT", // verbatim, but the surrounding text changes its meaning
      "WRONG_STANCE", // the quote does not support the stance recorded
      "WRONG_PROPOSITION", // the quote is about something else
      "SUMMARY_OVERSTATES", // the summary claims more than the quote does
    ])
    .default("NONE"),
  explanation: z.string().max(800),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ABSENCE_SYSTEM = `You are auditing a published claim that a candidate has NOT stated a
position. A voter can read it right now, and it is shown to them as a finding about the candidate
rather than a gap in our research.

You are given a question and the full text of a document archived from that candidate's campaign
site. Decide one thing: does this document state a position on that question?

Answer correct=true when the document genuinely does not address it. That is the common and expected
outcome — most campaign pages address a handful of questions and are silent on the rest, and
recording that silence is the point of this product.

Answer correct=false ONLY when the document does state a position that was missed. Quote the sentence
that states it in your explanation. If you cannot quote one, the absence is correct.

Do not count these as stating a position:
  a value or a slogan — "protect life", "tackle the climate crisis", "fighting for families"
  an accomplishment — "I secured $2M for our schools"
  caring about the subject without saying what should change
  a statement about a related but different question. "Invest in de-escalation training" is not a
  position on whether police funding should rise; "make voting easier" is not a position on
  no-excuse mail voting.

The last one matters most. An absence is wrong only if the document answers THIS question, not a
neighbouring one.`;

export const AUDIT_SYSTEM = `You are auditing a claim that is already published on a public voter guide.
A voter can read it right now.

You are given a question, the stance recorded for a candidate, the summary shown to voters, the quote
shown as evidence, and the surrounding text of the archived document the quote came from.

Decide whether the published claim is correct. It is correct only if all of these hold:

1. The quote appears in the source text, word for word.
2. The quote, read WITH its surrounding context, still means what the stance says. A verbatim quote
   can still misrepresent — a sentence lifted out of "some argue that X, but I disagree" is accurate
   as a string and false as a claim. This is the failure a pre-publication check cannot see, and it
   is the main thing you are here for.
3. The quote is about the question asked, not an adjacent subject.
4. The summary does not claim more than the quote supports.

Judge the published claim, not the candidate. You are not deciding whether the position is good.

Say correct=false when you are unsure. This measures a live product, and a rate that flatters it is
worse than no rate.`;

export interface AuditReport {
  sampled: number;
  correct: number;
  errorRate: number;
  faults: Record<string, number>;
  costCents: number;
  errors: Array<{
    positionId: string;
    candidate: string;
    issue: string;
    stance: string;
    fault: string;
    explanation: string;
    quote: string;
    sourceUrl: string;
  }>;
}

/** Deterministic from a seed, so a reported rate can be reproduced exactly. */
function sample<T>(rows: T[], n: number, seed: number): T[] {
  let x = seed || 1;
  const next = () => (x = (x * 1103515245 + 12345) & 0x7fffffff);
  const picked = [...rows];
  for (let i = picked.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [picked[i], picked[j]] = [picked[j]!, picked[i]!];
  }
  return picked.slice(0, n);
}

export interface AuditOptions {
  electionSlug?: string;
  size?: number;
  seed?: number;
  /** Absences carry no quote; auditing them asks a different question. */
  includeAbsences?: boolean;
  /** Audit ONLY absences. 7,965 of them were live and never measured. */
  onlyAbsences?: boolean;
  model?: string;
  complete?: CompleteFn;
  concurrency?: number;
  contextChars?: number;
  /** Stop once the run has spent this many cents. */
  maxCostCents?: number;
}

export async function auditPublished(opts: AuditOptions = {}): Promise<AuditReport> {
  const model = opts.model ?? AUDIT_MODEL;
  const fn = opts.complete ?? complete;
  const size = opts.size ?? 60;
  const context = opts.contextChars ?? 1200;

  const live = await prisma.position.findMany({
    where: {
      status: "PUBLISHED",
      ...(opts.onlyAbsences
        ? { stance: { in: ["NO_STATED_POSITION", "DECLINED_TO_STATE"] } }
        : opts.includeAbsences
          ? {}
          : { stance: { notIn: ["NO_STATED_POSITION", "DECLINED_TO_STATE"] } }),
      ...(opts.electionSlug
        ? { candidate: { candidacies: { some: { race: { election: { slug: opts.electionSlug } } } } } }
        : {}),
    },
    select: {
      id: true,
      stance: true,
      summary: true,
      candidate: {
        select: {
          fullName: true,
          // Sources hang off the candidate, not the position. An absence has no
          // evidence row by definition, so the document it was decided from is
          // reached this way.
          sources: { select: { url: true, text: true }, take: 1, where: { NOT: { text: "" } } },
        },
      },
      issue: { select: { slug: true } },
      proposition: { select: { text: true } },
      evidence: {
        select: {
          quote: true,
          startOffset: true,
          endOffset: true,
          source: { select: { url: true, text: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const chosen = sample(live, size, opts.seed ?? 42);
  const report: AuditReport = {
    sampled: 0,
    correct: 0,
    errorRate: 0,
    faults: {},
    costCents: 0,
    errors: [],
  };

  const queue = [...chosen];
  let stopped = false;
  const worker = async () => {
    for (;;) {
      if (stopped) return;
      if (opts.maxCostCents != null && report.costCents >= opts.maxCostCents) {
        stopped = true;
        return;
      }
      const p = queue.shift();
      if (!p) return;
      const ev = p.evidence[0];

      // An absence carries no quote by definition, so it is audited against the whole
      // document instead: did we miss a position that is actually stated there? A
      // wrong absence tells a voter a candidate is silent when they are not, which is
      // a claim about the candidate and not about our coverage.
      if (!ev) {
        const doc = p.candidate?.sources?.[0];
        if (!doc?.text) {
          report.sampled++;
          report.faults.NO_SOURCE = (report.faults.NO_SOURCE ?? 0) + 1;
          continue;
        }
        try {
          const res = await fn({
            model,
            system: ABSENCE_SYSTEM,
            input:
              `QUESTION: ${p.proposition?.text ?? p.issue.slug}\n\n` +
              `PUBLISHED CLAIM: this candidate has not stated a position on it.\n\n` +
              `THE ARCHIVED DOCUMENT:\n"""\n${doc.text.slice(0, 12000)}\n"""`,
            schema: FindingSchema,
          });
          report.costCents += res.costCents;
          report.sampled++;
          if (res.output.correct) {
            report.correct++;
          } else {
            report.faults.MISSED_POSITION = (report.faults.MISSED_POSITION ?? 0) + 1;
            report.errors.push({
              positionId: p.id,
              candidate: p.candidate?.fullName ?? "unknown",
              issue: p.issue.slug,
              stance: p.stance,
              fault: "MISSED_POSITION",
              explanation: res.output.explanation,
              quote: "",
              sourceUrl: doc.url,
            });
          }
        } catch {
          report.sampled++;
          report.faults.ERROR = (report.faults.ERROR ?? 0) + 1;
        }
        continue;
      }

      // The text AROUND the quote, which is what a pre-publication check never sees.
      const src = ev.source.text ?? "";
      const from = Math.max(0, ev.startOffset - context);
      const to = Math.min(src.length, ev.endOffset + context);
      const surrounding = src.slice(from, to);

      try {
        const res = await fn({
          model,
          system: AUDIT_SYSTEM,
          input:
            `QUESTION: ${p.proposition?.text ?? p.issue.slug}\n\n` +
            `PUBLISHED STANCE: ${p.stance}\n` +
            `PUBLISHED SUMMARY: ${p.summary}\n\n` +
            `QUOTE SHOWN AS EVIDENCE:\n"""\n${ev.quote}\n"""\n\n` +
            `THE DOCUMENT AROUND IT:\n"""\n${surrounding}\n"""`,
          schema: FindingSchema,
        });
        report.costCents += res.costCents;
        report.sampled++;

        if (res.output.correct) {
          report.correct++;
          continue;
        }
        report.faults[res.output.fault] = (report.faults[res.output.fault] ?? 0) + 1;
        report.errors.push({
          positionId: p.id,
          candidate: p.candidate?.fullName ?? "unknown",
          issue: p.issue.slug,
          stance: p.stance,
          fault: res.output.fault,
          explanation: res.output.explanation,
          quote: ev.quote.slice(0, 180),
          sourceUrl: ev.source.url,
        });
      } catch (err) {
        report.sampled++;
        report.faults.ERROR = (report.faults.ERROR ?? 0) + 1;
        const msg = err instanceof Error ? err.message : String(err);
        if (/credit balance|authentication_error|invalid x-api-key/i.test(msg)) stopped = true;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, queue.length) }, worker));
  report.errorRate = report.sampled === 0 ? 0 : (report.sampled - report.correct) / report.sampled;
  return report;
}

/**
 * The 95% Wilson interval.
 *
 * A rate from 60 rows is not a point. Reporting "3.3% wrong" from two errors in
 * sixty, without saying the true rate could be 12%, is the kind of precision that
 * misleads the person relying on it.
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / d), Math.min(1, (centre + spread) / d)];
}
