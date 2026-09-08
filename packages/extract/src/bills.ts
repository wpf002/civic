/**
 * Deciding what a vote on a bill means for a proposition.
 *
 * A roll call is a fact: this member voted Yea on HR 5103. Turning that into a
 * position requires two judgments — does this bill bear on the proposition at all,
 * and does a Yea agree or disagree with it — and both are made ONCE PER BILL.
 *
 * That is the whole design. One decision covers every member who voted on that roll
 * call. It is reviewed once, it cannot mean different things for different
 * candidates, and if it is wrong it is wrong in one visible place rather than
 * silently in 435 rows.
 *
 * The basis is the official CRS summary from Congress.gov, not the bill's title. A
 * title is written to persuade — "Make the District of Columbia Safe and Beautiful
 * Act" says nothing about what the bill does — and a product that reads titles would
 * be laundering a sponsor's framing into a candidate's record.
 *
 * Most bills map to nothing, and that is the normal case. A procedural motion, an
 * appropriation, a post office naming: no mapping, no positions.
 */
import { z } from "zod";
import { prisma } from "@civic/db";
import { MODEL_A, complete, type CompleteFn } from "./llm.js";

export const MAP_MODEL = process.env.BILL_MAP_MODEL ?? MODEL_A;

export const MappingSchema = z.object({
  /** Does this bill bear on the proposition at all? Most do not. */
  bearsOn: z.boolean(),
  /**
   * Which way a Yea points on this proposition. Only meaningful when bearsOn.
   *
   * NOT the sponsor's intent and NOT whether the bill is good. Only: does voting Yes
   * move the world toward the proposition being true, or away from it.
   */
  yeaMeans: z
    .enum(["STRONG_SUPPORT", "SUPPORT", "MIXED", "OPPOSE", "STRONG_OPPOSE"])
    .nullable()
    .default(null),
  /** The sentence in the summary that settles it. */
  basis: z.string().max(600),
  reasoning: z.string().max(800),
});
export type Mapping = z.infer<typeof MappingSchema>;

export const MAP_SYSTEM = `You are deciding whether a recorded vote on a bill tells a voter anything about
where a legislator stands on one specific proposition.

You are given the proposition, what agreeing and disagreeing with it mean, and the official summary of
a bill. Decide two things.

1. Does this bill bear on the proposition? Be strict. It bears on it only if voting on the bill is
   effectively voting on the change the proposition describes. A bill that touches the same broad
   subject is NOT enough — an appropriation for a housing agency does not answer a question about
   what may be built on a lot.

   Most bills bear on nothing in a list like this. Procedural motions, appropriations, renamings,
   commemorations, and narrow technical amendments almost never do. Answering "no" is the common and
   correct outcome; say so without hedging.

2. If it does bear on it, which way does a Yea point? Not the sponsor's intent, not whether the bill
   is good policy, not who supported it. Only this: does voting Yes move the world toward the
   proposition being true, or away from it?

   A Yea that partly moves toward and partly away is MIXED. Strength follows how decisively the bill
   settles the question: a bill that directly enacts the change is STRONG; one that takes a step
   toward it, funds a study of it, or applies it narrowly is not.

Read the summary, not the title. Bill titles are written to persuade and often describe an intention
the text does not carry. If the summary does not establish what the bill does, answer bearsOn=false
rather than inferring from the name.

Quote in "basis" the sentence from the summary that settles it. If you cannot quote one, you do not
have a basis, and the answer is bearsOn=false.

You are not judging whether the bill is good, popular, or wise. A voter will decide that.`;

export interface BillInput {
  billId: string;
  title: string;
  summary: string;
  /** Congress.gov's own subject classification, e.g. "Health", "Armed Forces and National Security". */
  policyArea?: string | null;
}

/**
 * Which propositions a policy area could possibly bear on.
 *
 * A cheap pre-filter, not a judgment. Classifying 12 bills against 20 propositions
 * cost 240 model calls and produced nothing, because a bill about tribal trust land
 * was being weighed against a question on background checks 20 times over. This cuts
 * the pairs that reach a model; it never decides one.
 *
 * Deliberately generous — a policy area listed here only earns a bill a look. An area
 * we do not recognise is sent to every proposition rather than dropped, because
 * silently skipping a bill would remove a vote from a candidate's record.
 */
const AREA_TO_ISSUES: Record<string, string[]> = {
  "Health": ["healthcare", "reproductive-rights"],
  "Taxation": ["taxes-budget", "economy-jobs"],
  "Economics and Public Finance": ["taxes-budget", "economy-jobs"],
  "Labor and Employment": ["economy-jobs"],
  "Commerce": ["economy-jobs", "tech-privacy-ai"],
  "Finance and Financial Sector": ["economy-jobs", "housing-cost-of-living"],
  "Housing and Community Development": ["housing-cost-of-living", "local-development-zoning"],
  "Education": ["education-k12", "higher-ed-student-debt"],
  "Crime and Law Enforcement": ["public-safety-policing", "criminal-justice", "guns"],
  "Law": ["criminal-justice", "civil-rights"],
  "Immigration": ["immigration"],
  "Energy": ["climate-energy"],
  "Environmental Protection": ["climate-energy", "environment-water"],
  "Water Resources Development": ["environment-water"],
  "Public Lands and Natural Resources": ["environment-water", "climate-energy"],
  "Transportation and Public Works": ["transportation-infrastructure"],
  "Government Operations and Politics": ["voting-elections", "civil-rights"],
  "Civil Rights and Liberties, Minority Issues": ["civil-rights", "lgbtq-rights"],
  "Science, Technology, Communications": ["tech-privacy-ai"],
  "Armed Forces and National Security": ["foreign-policy-defense"],
  "International Affairs": ["foreign-policy-defense"],
  "Agriculture and Food": ["environment-water", "economy-jobs"],
  "Social Welfare": ["healthcare", "housing-cost-of-living"],
};

/** Propositions worth asking a model about for this bill. */
export function candidateIssues(policyArea: string | null | undefined): string[] | null {
  if (!policyArea) return null; // unknown: check everything rather than drop the bill
  return AREA_TO_ISSUES[policyArea.trim()] ?? null;
}

export interface PropositionInput {
  id: string;
  issueSlug: string;
  text: string;
  yesMeans: string;
  noMeans: string;
}

export interface MapReport {
  bills: number;
  pairsChecked: number;
  proposed: number;
  costCents: number;
  details: Array<{ billId: string; issueSlug: string; yeaMeans: string; reasoning: string }>;
}

/**
 * Propose mappings for a set of bills.
 *
 * Writes PROPOSED rows only. Nothing becomes a position until a person confirms it,
 * because this is the single point where a factual vote becomes an interpreted claim.
 */
export async function proposeMappings(
  bills: BillInput[],
  propositions: PropositionInput[],
  opts: { dryRun?: boolean; model?: string; complete?: CompleteFn; concurrency?: number } = {},
): Promise<MapReport> {
  const model = opts.model ?? MAP_MODEL;
  const fn = opts.complete ?? complete;
  const report: MapReport = { bills: bills.length, pairsChecked: 0, proposed: 0, costCents: 0, details: [] };

  const queue: Array<{ bill: BillInput; prop: PropositionInput }> = [];
  for (const bill of bills) {
    const allowed = candidateIssues(bill.policyArea);
    for (const prop of propositions) {
      if (allowed && !allowed.includes(prop.issueSlug)) continue;
      queue.push({ bill, prop });
    }
  }

  const worker = async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      const { bill, prop } = job;
      try {
        const res = await fn({
          model,
          system: MAP_SYSTEM,
          input:
            `PROPOSITION: ${prop.text}\n` +
            `  agreeing means: ${prop.yesMeans}\n` +
            `  disagreeing means: ${prop.noMeans}\n\n` +
            `BILL ${bill.billId}: ${bill.title}\n\n` +
            `OFFICIAL SUMMARY:\n${bill.summary}`,
          schema: MappingSchema,
        });
        report.costCents += res.costCents;
        report.pairsChecked++;

        const m = res.output;
        if (!m.bearsOn || !m.yeaMeans) continue;

        report.proposed++;
        report.details.push({
          billId: bill.billId,
          issueSlug: prop.issueSlug,
          yeaMeans: m.yeaMeans,
          reasoning: m.reasoning,
        });

        if (!opts.dryRun) {
          await prisma.billProposition.upsert({
            where: { billId_propositionId: { billId: bill.billId, propositionId: prop.id } },
            update: {},
            create: {
              billId: bill.billId,
              propositionId: prop.id,
              yeaMeans: m.yeaMeans,
              basis: m.basis,
              reasoning: m.reasoning,
              status: "PROPOSED",
            },
          });
        }
      } catch {
        report.pairsChecked++;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 8, queue.length) }, worker));
  return report;
}

/** A Nay is the opposite of a Yea. Present and Not Voting answer nothing. */
export function stanceFromVote(voteCast: string, yeaMeans: string): string | null {
  const v = voteCast.toUpperCase();
  if (v === "YEA" || v === "AYE" || v === "YES") return yeaMeans;
  if (v !== "NAY" && v !== "NO") return null; // Present, Not Voting: not an answer
  const flip: Record<string, string> = {
    STRONG_SUPPORT: "STRONG_OPPOSE",
    SUPPORT: "OPPOSE",
    OPPOSE: "SUPPORT",
    STRONG_OPPOSE: "STRONG_SUPPORT",
    MIXED: "MIXED",
  };
  return flip[yeaMeans] ?? null;
}

// ---------------------------------------------------------------- verification

/**
 * An independent second look at a proposed mapping.
 *
 * The classifier hedged in its own reasoning on all three of its first mappings —
 * "it does not itself mandate money bail", "the effect is narrow", "it is a
 * non-binding expression of sentiment" — and approved every one anyway. A model
 * asked "does this bear on that" will find a thread connecting almost any two
 * things. Asked instead to REFUTE, it has to defend the connection.
 *
 * The bar is deliberately high, because a wrong mapping is worse here than anywhere
 * else in the pipeline: it attaches a position to every member who voted, at once,
 * from a vote they cast about something else.
 */
export const REFUTE_SYSTEM = `You are checking a claim that a vote on a bill tells a voter where a
legislator stands on a specific proposition. Your job is to REFUTE it if you can.

The claim is only sound if a legislator voting on this bill was, in substance, voting on the change
the proposition describes. Reject it if any of these is true:

- The bill is about the same broad subject but a different decision. Adjacent is not the same.
- The bill is procedural, a reporting or study requirement, a resolution expressing sentiment, or
  otherwise changes no rule. A vote on whether to publish a list about a policy is not a vote on the
  policy.
- The bill's effect on the proposition is incidental, narrow, or technical. A trade preference for
  one country's apparel imports is not an answer to whether this government should raise taxes, even
  though duties are technically a tax.
- The direction is wrong, or the connection only holds if you assume why the sponsor wrote it.
- The summary does not establish what the bill does.

Default to refuting. If you find yourself writing "it does not itself..." or "the effect is narrow"
or "although it is non-binding", you have already refuted it — say so rather than approving it with
a caveat.

A wrong mapping attaches a position to every member who voted on that bill, from a vote they cast
about something else. That is worse than having no position for them at all.`;

export const RefutationSchema = z.object({
  holdsUp: z.boolean(),
  reason: z.string().max(600),
});

export interface RefuteReport {
  checked: number;
  upheld: number;
  refuted: number;
  costCents: number;
  rejections: Array<{ billId: string; issueSlug: string; reason: string }>;
}

export async function verifyMappings(
  opts: { dryRun?: boolean; model?: string; complete?: CompleteFn; concurrency?: number } = {},
): Promise<RefuteReport> {
  const model = opts.model ?? MAP_MODEL;
  const fn = opts.complete ?? complete;

  const proposed = await prisma.billProposition.findMany({
    where: { status: "PROPOSED" },
    include: { proposition: { include: { issue: { select: { slug: true } } } } },
  });

  const report: RefuteReport = { checked: 0, upheld: 0, refuted: 0, costCents: 0, rejections: [] };
  const queue = [...proposed];

  const worker = async () => {
    for (;;) {
      const m = queue.shift();
      if (!m) return;
      try {
        const res = await fn({
          model,
          system: REFUTE_SYSTEM,
          input:
            `PROPOSITION: ${m.proposition.text}\n` +
            `  agreeing means: ${m.proposition.yesMeans}\n` +
            `  disagreeing means: ${m.proposition.noMeans}\n\n` +
            `CLAIM: a Yea on ${m.billId} means ${m.yeaMeans} on this proposition.\n\n` +
            `BASIS OFFERED, quoted from the official summary:\n${m.basis}\n\n` +
            `REASONING OFFERED:\n${m.reasoning}`,
          schema: RefutationSchema,
        });
        report.costCents += res.costCents;
        report.checked++;

        if (res.output.holdsUp) {
          report.upheld++;
          if (!opts.dryRun) {
            await prisma.billProposition.update({
              where: { id: m.id },
              data: { status: "CONFIRMED", decidedBy: `verifier:${model}`, decidedAt: new Date() },
            });
          }
        } else {
          report.refuted++;
          report.rejections.push({
            billId: m.billId,
            issueSlug: m.proposition.issue.slug,
            reason: res.output.reason,
          });
          if (!opts.dryRun) {
            await prisma.billProposition.update({
              where: { id: m.id },
              data: { status: "REJECTED", decidedBy: `verifier:${model}`, decidedAt: new Date() },
            });
          }
        }
      } catch {
        report.checked++;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, queue.length) }, worker));
  return report;
}
