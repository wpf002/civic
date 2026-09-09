import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@civic/db";
import { runExtraction } from "./pipeline-db.js";
import type { CompleteFn } from "./llm.js";

/**
 * Exercises the DB pipeline with a recorded model, so CI never calls a model.
 */
const PREFIX = "zz-extract-test-";

const DOC = `Priorities

Housing. I will vote to allow fourplexes on every residential lot in this district,
and I will vote to end parking minimums for small buildings.`;

/** Two "models" that agree, so reconcile produces a draft. */
const agreeing = (quote: string): CompleteFn =>
  (async () => ({
    model: "recorded",
    costCents: 0.4,
    output: {
      positions: [
        {
          issueSlug: "housing-cost-of-living",
          stance: "STRONG_SUPPORT",
          summary: "Would allow fourplexes on every residential lot and end parking minimums.",
          quote,
          confidence: 0.95,
        },
      ],
    },
  })) as unknown as CompleteFn;

let sourceId: string;
let candidateId: string;

async function purge() {
  const cands = await prisma.candidate.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = cands.map((c) => c.id);
  if (ids.length) {
    const positions = await prisma.position.findMany({ where: { candidateId: { in: ids } } });
    await prisma.position.deleteMany({ where: { candidateId: { in: ids } } });
    void positions;
    const srcs = await prisma.source.findMany({ where: { candidateId: { in: ids } } });
    await prisma.evidence.deleteMany({ where: { sourceId: { in: srcs.map((s) => s.id) } } });
    await prisma.source.deleteMany({ where: { candidateId: { in: ids } } });
    await prisma.candidacy.deleteMany({ where: { candidateId: { in: ids } } });
    await prisma.candidate.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.reviewTask.deleteMany({ where: { reason: { contains: PREFIX } } });
}

beforeEach(async () => {
  await purge();
  const race = await prisma.race.findFirstOrThrow({
    where: { election: { slug: "2027-11-dallas" }, office: { district: { name: "District 7" } } },
  });
  const cand = await prisma.candidate.create({
    data: { slug: `${PREFIX}subject`, fullName: "ZZ Extract Subject" },
  });
  candidateId = cand.id;
  await prisma.candidacy.create({ data: { raceId: race.id, candidateId } });
  const src = await prisma.source.create({
    data: {
      kind: "CANDIDATE_WEBSITE",
      tier: "CAMPAIGN_PLATFORM",
      url: `https://example.org/${PREFIX}${Date.now()}`,
      contentHash: `${PREFIX}${Date.now()}`,
      text: DOC,
      candidateId,
    },
  });
  sourceId = src.id;
});

afterAll(purge);

describe("runExtraction", () => {
  it("refuses to run two samples of the same model", async () => {
    await expect(
      runExtraction({ sourceId, modelA: "same", modelB: "same" }),
    ).rejects.toThrow(/must differ/);
  });

  it("writes a DRAFT with the source's own span, not the model's string", async () => {
    // The model returns the quote unwrapped; the source has a hard line break in it.
    const unwrapped =
      "I will vote to allow fourplexes on every residential lot in this district, and I will vote to end parking minimums for small buildings.";
    expect(DOC.includes(unwrapped)).toBe(false);

    const r = await runExtraction({ sourceId, complete: agreeing(unwrapped) });
    expect(r.drafts).toBe(1);

    const p = await prisma.position.findFirstOrThrow({
      where: { candidateId },
      include: { evidence: true },
    });
    expect(p.status).toBe("DRAFT");
    const quote = p.evidence[0]!.quote;
    expect(DOC.includes(quote)).toBe(true); // byte-exact slice of the archived text
    expect(quote).toContain("\n");
    expect(quote).not.toBe(unwrapped);
  });

  it("drops a position whose quote is not in the source, and stores nothing", async () => {
    const r = await runExtraction({ sourceId, complete: agreeing("I will vote to ban fourplexes") });
    expect(r.rejectedQuotes).toBeGreaterThan(0);
    expect(r.drafts).toBe(0);
    expect(await prisma.position.count({ where: { candidateId } })).toBe(0);
  });

  it("opens a review task on model disagreement instead of picking a winner", async () => {
    let call = 0;
    const disagreeing: CompleteFn = (async () => {
      call++;
      return {
        model: `recorded-${call}`,
        costCents: 0.2,
        output: {
          positions: [
            {
              issueSlug: "housing-cost-of-living",
              stance: call === 1 ? "STRONG_SUPPORT" : "OPPOSE",
              summary: "s",
              quote: "I will vote to allow fourplexes on every residential lot in this district",
              confidence: 0.9,
            },
          ],
        },
      };
    }) as unknown as CompleteFn;

    const r = await runExtraction({ sourceId, complete: disagreeing });
    expect(r.drafts).toBe(0);
    expect(r.flagged).toBe(1);
    const task = await prisma.reviewTask.findFirst({ where: { targetId: sourceId } });
    expect(task!.reason).toMatch(/Model disagreement/);
  });

  it("never overwrites a PUBLISHED position; it asks for a supersede instead", async () => {
    const issue = await prisma.issue.findUniqueOrThrow({ where: { slug: "housing-cost-of-living" } });
    await prisma.position.create({
      data: {
        candidateId,
        issueId: issue.id,
        stance: "OPPOSE",
        summary: "already published",
        confidence: 0.9,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });

    const r = await runExtraction({
      sourceId,
      complete: agreeing("I will vote to allow fourplexes on every residential lot in this district"),
    });
    expect(r.drafts).toBe(0);
    const published = await prisma.position.findFirstOrThrow({
      where: { candidateId, status: "PUBLISHED" },
    });
    expect(published.summary).toBe("already published"); // untouched
    const task = await prisma.reviewTask.findFirst({ where: { targetId: published.id } });
    expect(task!.reason).toMatch(/must supersede, not overwrite/);
  });

  it("dry run writes nothing", async () => {
    const r = await runExtraction({
      sourceId,
      dryRun: true,
      complete: agreeing("I will vote to allow fourplexes on every residential lot in this district"),
    });
    expect(r.drafts).toBe(1);
    expect(r.extractRunId).toBeNull();
    expect(await prisma.position.count({ where: { candidateId } })).toBe(0);
  });
});

describe("processing many sources", () => {
  it("runs sources concurrently and reports progress", async () => {
    // The sequential version took 83 minutes for 311 sources. Sources are
    // independent — nothing one produces changes how another is read.
    let inFlight = 0;
    let peak = 0;
    const slow: CompleteFn = (async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { model: "recorded", output: { positions: [] }, costCents: 0 };
    }) as unknown as CompleteFn;

    const seen: number[] = [];
    const report = await runExtraction({
      dryRun: true,
      complete: slow,
      concurrency: 4,
      onProgress: (done) => seen.push(done),
    });

    if (report.sources > 1) expect(peak).toBeGreaterThan(1);
    expect(seen.length).toBe(report.sources);
    // Progress must be monotonic, or a "3 of 10" line means nothing.
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

/** Replays recorded output. Local, because the shared one lives in pipeline.test.ts. */
const replay = (positions: unknown[]): CompleteFn =>
  (async () => ({ model: "recorded", output: { positions }, costCents: 0.1 })) as unknown as CompleteFn;

describe("not spending money twice", () => {
  it("skips sources that already produced evidence", async () => {
    // The default. Re-reading a source costs the same and produces the same answer.
    const all = await runExtraction({ dryRun: true, force: true, complete: replay([]) });
    const fresh = await runExtraction({ dryRun: true, complete: replay([]) });
    expect(fresh.sources).toBeLessThanOrEqual(all.sources);
  });

  it("stops dead on an exhausted balance instead of repeating it per source", async () => {
    // A run meant for 84 pages processed 466 and logged the same credit error for
    // every one of them after the balance ran out.
    let calls = 0;
    const broke: CompleteFn = (async () => {
      calls++;
      throw new Error('400 {"error":{"message":"Your credit balance is too low"}}');
    }) as unknown as CompleteFn;

    await expect(
      runExtraction({ dryRun: true, force: true, concurrency: 1, complete: broke }),
    ).rejects.toThrow(/credit balance/);
    // One source's two model calls, not every source's.
    expect(calls).toBeLessThanOrEqual(2);
  });

  it("stops at the cost limit", async () => {
    const pricey: CompleteFn = (async () => ({
      model: "recorded",
      output: { positions: [] },
      costCents: 50,
    })) as unknown as CompleteFn;

    await expect(
      runExtraction({ dryRun: true, force: true, maxCostCents: 60, complete: pricey }),
    ).rejects.toThrow(/--max-cost limit/);
  });
});
