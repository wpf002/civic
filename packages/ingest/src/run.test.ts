import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@civic/db";
import { persistRun } from "./run.js";
import { nameKey, type Roster } from "./roster.js";

/**
 * The invariant this whole package exists to protect, tested against the real
 * database: a removal never reaches the write path.
 */
const ELECTION = "2027-11-dallas";

/**
 * These tests write to the real fixture database, so every row they create is
 * namespaced and removed afterwards. Left behind, they broke the API contract test
 * that asserts candidates come back in ballot order — test pollution that shows up
 * three packages away is worse than a slow test.
 */
const TEST_PREFIX = "zz-ingest-test-";
const testName = (n: string) => `ZZ Ingest ${n}`;

async function raceForDistrict7(): Promise<string> {
  const r = await prisma.race.findFirstOrThrow({
    where: { election: { slug: ELECTION }, office: { district: { name: "District 7" } } },
  });
  return r.id;
}

const roster = (names: string[]): Roster => ({
  raceKey: "test-race",
  entries: names.map((n) => ({ key: `${TEST_PREFIX}${nameKey(n)}`, name: testName(n) })),
  sourceUrl: "https://example.org/test-roster",
  observedAt: new Date(),
});

let raceId: string;

async function purge() {
  const mine = await prisma.candidate.findMany({
    where: { slug: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  const ids = mine.map((m) => m.id);
  if (ids.length) await prisma.candidacy.deleteMany({ where: { candidateId: { in: ids } } });
  await prisma.candidate.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
  await prisma.rosterDiff.deleteMany({ where: { raceId } });
  await prisma.rosterSnapshot.deleteMany({ where: { raceId } });
  await prisma.reviewTask.deleteMany({ where: { reason: { contains: "test-race" } } });
}

beforeEach(async () => {
  raceId = await raceForDistrict7();
  await purge();
});

afterAll(async () => {
  await purge();
  // Leave the fixture race exactly as seeded.
  await prisma.race.update({ where: { id: raceId }, data: { rosterStatus: "UNKNOWN" } });
});

const resolve = async () => raceId;

describe("persistRun", () => {
  it("records a snapshot and a diff on every run", async () => {
    await persistRun({ adapter: "test", electionSlug: ELECTION }, [roster(["Ada Test"])], resolve);
    expect(await prisma.rosterSnapshot.count({ where: { raceId } })).toBe(1);
    expect(await prisma.rosterDiff.count({ where: { raceId } })).toBe(1);
  });

  it("auto-applies an additive change and marks the snapshot accepted", async () => {
    const out = await persistRun(
      { adapter: "test", electionSlug: ELECTION },
      [roster(["Ada Test", "Bo Sample"])],
      resolve,
    );
    expect(out.races[0]!.verdict).toBe("AUTO_APPLIED");
    const snap = await prisma.rosterSnapshot.findFirstOrThrow({ where: { raceId } });
    expect(snap.accepted).toBe(true);
  });

  it("QUARANTINES a removal, writes no candidacy change, and opens a review task", async () => {
    await persistRun(
      { adapter: "test", electionSlug: ELECTION },
      [roster(["Ada Test", "Bo Sample"])],
      resolve,
    );
    const before = await prisma.candidacy.count({ where: { raceId } });

    const out = await persistRun(
      { adapter: "test", electionSlug: ELECTION },
      [roster(["Ada Test"])], // Bo Sample vanishes
      resolve,
    );

    expect(out.races[0]!.verdict).toBe("QUARANTINED");
    expect(out.races[0]!.removed).toEqual([testName("Bo Sample")]);
    expect(out.races[0]!.applied).toBe(false);
    // The roster on record is untouched.
    expect(await prisma.candidacy.count({ where: { raceId } })).toBe(before);

    const quarantined = await prisma.rosterDiff.findFirst({
      where: { raceId, verdict: "QUARANTINED" },
    });
    expect(quarantined).not.toBeNull();
    const task = await prisma.reviewTask.findFirst({
      where: { targetId: quarantined!.toSnapshotId },
    });
    expect(task).not.toBeNull();
  });

  it("does not let a quarantined parse become the new baseline", async () => {
    await persistRun({ adapter: "test", electionSlug: ELECTION }, [roster(["Ada Test", "Bo Sample"])], resolve);
    await persistRun({ adapter: "test", electionSlug: ELECTION }, [roster([])], resolve); // bad fetch
    // The next good run compares against the last ACCEPTED snapshot, so the bad
    // empty parse does not make everyone look "added".
    const out = await persistRun(
      { adapter: "test", electionSlug: ELECTION },
      [roster(["Ada Test", "Bo Sample"])],
      resolve,
    );
    expect(out.races[0]!.verdict).toBe("AUTO_APPLIED");
    expect(out.races[0]!.added).toEqual([]);
  });

  it("never writes a candidacy for an unnamed ballot line", async () => {
    const r = roster(["Ada Test"]);
    r.entries.push({ key: "placeholder-1", name: "Write-In Candidate", isPlaceholder: true });
    const out = await persistRun({ adapter: "test", electionSlug: ELECTION }, [r], resolve);
    // A placeholder quarantines the whole diff, so nothing is written at all.
    expect(out.races[0]!.verdict).toBe("QUARANTINED");
    const names = await prisma.candidacy.findMany({
      where: { raceId },
      include: { candidate: true },
    });
    expect(names.map((n) => n.candidate.fullName)).not.toContain("Write-In Candidate");
  });

  it("refuses a roster for a race it cannot resolve, rather than creating one", async () => {
    const before = await prisma.race.count();
    const out = await persistRun(
      { adapter: "test", electionSlug: ELECTION },
      [roster(["Ada Test"])],
      async () => null,
    );
    expect(out.races[0]!.verdict).toBe("QUARANTINED");
    expect(out.races[0]!.reasons.join(" ")).toMatch(/never creates a race/);
    expect(await prisma.race.count()).toBe(before);
  });

  it("dry run writes nothing", async () => {
    const runs = await prisma.ingestRun.count();
    const out = await persistRun(
      { adapter: "test", electionSlug: ELECTION, dryRun: true },
      [roster(["Ada Test"])],
      resolve,
    );
    expect(out.ingestRunId).toBeNull();
    expect(await prisma.ingestRun.count()).toBe(runs);
    expect(await prisma.rosterSnapshot.count({ where: { raceId } })).toBe(0);
  });
});
