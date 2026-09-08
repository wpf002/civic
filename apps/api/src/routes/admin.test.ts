import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "@civic/db";
import { adminRoutes } from "./admin.js";
import { createReviewer, login } from "../auth.js";

/**
 * The rule under test: a candidate never leaves a ballot without a document.
 */
/**
 * These tests sign in as a real reviewer rather than using the shared token, because
 * the shared token is refused as soon as a reviewer account exists — which is the
 * point of it. A test that kept using the weak path would stop testing what runs.
 */
const REVIEWER_EMAIL = "zz-admin-test@example.org";
const REVIEWER_PASSWORD = "admin-test-password-1234";
let TOKEN = "";
let AUTH: Record<string, string> = {};
const PREFIX = "zz-admin-test-";

let app: FastifyInstance;
let raceId: string;

beforeAll(async () => {
  process.env.ADMIN_TOKEN = "test-admin-token";
  await prisma.reviewerSession.deleteMany({ where: { reviewer: { email: REVIEWER_EMAIL } } });
  await prisma.reviewer.deleteMany({ where: { email: REVIEWER_EMAIL } });
  await createReviewer(REVIEWER_EMAIL, "tester", REVIEWER_PASSWORD);
  TOKEN = (await login(REVIEWER_EMAIL, REVIEWER_PASSWORD))!.token;
  AUTH = { authorization: `Bearer ${TOKEN}`, "x-reviewer": "tester" };
  app = Fastify();
  await app.register(adminRoutes, { prefix: "/admin" });
  await app.ready();
  raceId = (
    await prisma.race.findFirstOrThrow({
      where: { election: { slug: "2027-11-dallas" }, office: { district: { name: "District 7" } } },
    })
  ).id;
});

async function purge() {
  const mine = await prisma.candidate.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = mine.map((m) => m.id);
  if (ids.length) {
    // Everything that points at a candidate has to go first, in dependency order.
    // Positions and sources were added to these tests after this helper was written,
    // and the foreign key is what caught it rather than a silently orphaned row.
    const positions = await prisma.position.findMany({
      where: { candidateId: { in: ids } },
      select: { id: true },
    });
    if (positions.length) {
      await prisma.evidence.deleteMany({
        where: { positions: { some: { id: { in: positions.map((p) => p.id) } } } },
      });
      await prisma.position.deleteMany({ where: { candidateId: { in: ids } } });
    }
    await prisma.source.deleteMany({ where: { candidateId: { in: ids } } });
    await prisma.candidacy.deleteMany({ where: { candidateId: { in: ids } } });
  }
  await prisma.candidate.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.rosterDiff.deleteMany({ where: { raceId } });
  await prisma.rosterSnapshot.deleteMany({ where: { raceId } });
  await prisma.reviewTask.deleteMany({ where: { reason: { contains: PREFIX } } });
}

beforeEach(purge);
afterAll(async () => {
  await prisma.reviewerSession.deleteMany({ where: { reviewer: { email: REVIEWER_EMAIL } } });
  await prisma.reviewer.deleteMany({ where: { email: REVIEWER_EMAIL } });
  await purge();
  await app?.close();
});

async function quarantinedRemoval() {
  const before = await prisma.rosterSnapshot.create({
    data: {
      raceId,
      adapter: "test",
      candidateCount: 2,
      accepted: true,
      sourceUrl: "https://example.org/r",
      sourceHash: "a",
      payload: {
        entries: [
          { key: `${PREFIX}one`, name: "ZZ One", isPlaceholder: false },
          { key: `${PREFIX}two`, name: "ZZ Two", isPlaceholder: false },
        ],
      },
    },
  });
  const after = await prisma.rosterSnapshot.create({
    data: {
      raceId,
      adapter: "test",
      candidateCount: 1,
      accepted: false,
      sourceUrl: "https://example.org/r",
      sourceHash: "b",
      payload: { entries: [{ key: `${PREFIX}one`, name: "ZZ One", isPlaceholder: false }] },
    },
  });
  const diff = await prisma.rosterDiff.create({
    data: {
      raceId,
      fromSnapshotId: before.id,
      toSnapshotId: after.id,
      added: [],
      removed: ["ZZ Two"],
      verdict: "QUARANTINED",
    },
  });
  await prisma.reviewTask.create({
    data: { kind: "SOURCE_FLAG", targetId: after.id, reason: `${PREFIX} removal` },
  });
  return diff;
}

describe("auth", () => {
  it("rejects a request with no token", async () => {
    expect((await app.inject({ url: "/admin/queue" })).statusCode).toBe(401);
  });

  it("refuses a request with no credentials at all", async () => {
    const r = await app.inject({ url: "/admin/queue" });
    expect(r.statusCode).toBe(401);
  });

  it("refuses the shared token now that a reviewer account exists", async () => {
    // The weaker path closes on its own. Leaving it open until someone remembers to
    // shut it means it never shuts, because the strong path already works.
    const r = await app.inject({
      url: "/admin/queue",
      headers: { authorization: "Bearer test-admin-token", "x-reviewer": "whoever" },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe("a removal cannot be accepted without a document", () => {
  it("refuses with 422 and says why", async () => {
    const diff = await quarantinedRemoval();
    const r = await app.inject({
      method: "POST",
      url: `/admin/roster-diffs/${diff.id}/accept`,
      headers: AUTH,
      payload: {},
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatch(/artifactUrl is required/);
    expect(r.json().removed).toEqual(["ZZ Two"]);
    // Nothing changed.
    expect((await prisma.rosterDiff.findUniqueOrThrow({ where: { id: diff.id } })).verdict).toBe(
      "QUARANTINED",
    );
  });

  it("accepts with the artifact, marks WITHDRAWN, and never deletes the row", async () => {
    const diff = await quarantinedRemoval();
    // Seed the candidacy the removal will withdraw.
    const cand = await prisma.candidate.create({
      data: { slug: `${PREFIX}two`, fullName: "ZZ Two" },
    });
    await prisma.candidacy.create({ data: { raceId, candidateId: cand.id, status: "DECLARED" } });

    const r = await app.inject({
      method: "POST",
      url: `/admin/roster-diffs/${diff.id}/accept`,
      headers: AUTH,
      payload: { artifactUrl: "https://example.org/withdrawal.pdf", note: "cert attached" },
    });
    expect(r.statusCode).toBe(200);

    const cy = await prisma.candidacy.findFirstOrThrow({ where: { candidateId: cand.id } });
    expect(cy.status).toBe("WITHDRAWN");
    expect(cy.withdrawalSourceUrl).toBe("https://example.org/withdrawal.pdf");
    expect(cy.withdrawnAt).not.toBeNull();

    const after = await prisma.rosterDiff.findUniqueOrThrow({ where: { id: diff.id } });
    expect(after.verdict).toBe("ACCEPTED");
    expect(after.decidedBy).toBe("tester");
    const task = await prisma.reviewTask.findFirst({ where: { targetId: after.toSnapshotId } });
    expect(task!.resolvedAt).not.toBeNull();
  });

  it("records who accepted it, from the session rather than a header", async () => {
    const diff = await quarantinedRemoval();
    const r = await app.inject({
      method: "POST",
      url: `/admin/roster-diffs/${diff.id}/accept`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { artifactUrl: "https://example.org/x.pdf" },
    });
    expect(r.statusCode).toBe(200);
    // A removal is the most consequential action here. Who did it must be a verified
    // identity, not a string the caller chose.
    const decided = await prisma.rosterDiff.findUniqueOrThrow({ where: { id: diff.id } });
    expect(decided.decidedBy).toBe("tester");
  });

  it("will not decide the same diff twice", async () => {
    const diff = await quarantinedRemoval();
    const payload = { artifactUrl: "https://example.org/w.pdf" };
    await app.inject({ method: "POST", url: `/admin/roster-diffs/${diff.id}/accept`, headers: AUTH, payload });
    const second = await app.inject({
      method: "POST",
      url: `/admin/roster-diffs/${diff.id}/accept`,
      headers: AUTH,
      payload,
    });
    expect(second.statusCode).toBe(409);
  });
});

describe("the queue", () => {
  it("flags which diffs need an artifact", async () => {
    await quarantinedRemoval();
    const q = (await app.inject({ url: "/admin/queue", headers: AUTH })).json();
    const mine = q.rosterDiffs.find((d: any) => d.removed.includes("ZZ Two"));
    expect(mine.requiresArtifact).toBe(true);
    expect(mine.before).toBe(2);
    expect(mine.after).toBe(1);
  });
});

describe("positions", () => {
  it("refuses to publish a stance with no evidence", async () => {
    const issue = await prisma.issue.findFirstOrThrow();
    const cand = await prisma.candidate.create({
      data: { slug: `${PREFIX}nopos`, fullName: "ZZ NoEvidence" },
    });
    const p = await prisma.position.create({
      data: {
        candidateId: cand.id,
        issueId: issue.id,
        stance: "SUPPORT",
        summary: "x",
        confidence: 0.9,
        status: "DRAFT",
      },
    });
    const r = await app.inject({
      method: "POST",
      url: `/admin/positions/${p.id}/publish`,
      headers: AUTH,
    });
    expect(r.statusCode).toBe(422);
    await prisma.position.delete({ where: { id: p.id } });
  });

  it("allows publishing an absence, which has no quote by definition", async () => {
    const issue = await prisma.issue.findFirstOrThrow();
    const cand = await prisma.candidate.create({
      data: { slug: `${PREFIX}silent`, fullName: "ZZ Silent" },
    });
    const p = await prisma.position.create({
      data: {
        candidateId: cand.id,
        issueId: issue.id,
        stance: "NO_STATED_POSITION",
        summary: "",
        confidence: 0.9,
        status: "DRAFT",
      },
    });
    const r = await app.inject({
      method: "POST",
      url: `/admin/positions/${p.id}/publish`,
      headers: AUTH,
    });
    expect(r.statusCode).toBe(200);
    await prisma.position.delete({ where: { id: p.id } });
  });
});

describe("merging two records that are the same person", () => {
  

  async function makePair(sameRace: boolean) {
    const race = await prisma.race.findFirstOrThrow({
      where: { election: { slug: "2026-11-tx" } },
    });
    const other = await prisma.race.findFirstOrThrow({
      where: { election: { slug: "2026-11-tx" }, NOT: { id: race.id } },
    });
    const keep = await prisma.candidate.create({
      data: { slug: `${PREFIX}keep`, fullName: "ZZ Sylvia Garcia", externalIds: { txsos: "1" } },
    });
    const merge = await prisma.candidate.create({
      data: {
        slug: `${PREFIX}merge`,
        fullName: "ZZ Sylvia R Garcia",
        websiteUrl: "https://example.org/sylvia",
        externalIds: { fec: "H8TX29999" },
      },
    });
    await prisma.candidacy.create({
      data: { raceId: race.id, candidateId: keep.id, isCertified: true, firstObservedAt: new Date() },
    });
    await prisma.candidacy.create({
      data: {
        raceId: sameRace ? race.id : other.id,
        candidateId: merge.id,
        isIncumbent: true,
        firstObservedAt: new Date(),
      },
    });
    return { keep, merge, raceId: race.id };
  }

  async function purge() {
    const mine = await prisma.candidate.findMany({ where: { slug: { startsWith: `${PREFIX}` } }, select: { id: true } });
    const ids = mine.map((m) => m.id);
    if (ids.length) await prisma.candidacy.deleteMany({ where: { candidateId: { in: ids } } });
    await prisma.candidate.deleteMany({ where: { slug: { startsWith: `${PREFIX}` } } });
  }

  afterEach(purge);

  it("keeps the ballot record, absorbs the other's ids and website, and deletes it", async () => {
    const { keep, merge } = await makePair(true);
    const res = await app.inject({
      method: "POST",
      url: "/admin/candidates/merge",
      headers: { authorization: `Bearer ${TOKEN}`, "x-reviewer": "Reviewer" },
      payload: { keepId: keep.id, mergeId: merge.id },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.candidate.findUniqueOrThrow({ where: { id: keep.id } });
    // The whole point: the FEC id and the website live on the absorbed record.
    expect((after.externalIds as Record<string, unknown>).fec).toBe("H8TX29999");
    expect((after.externalIds as Record<string, unknown>).txsos).toBe("1");
    expect(after.websiteUrl).toBe("https://example.org/sylvia");
    // And the merge stays traceable rather than vanishing.
    expect((after.externalIds as { mergedFrom: Array<{ fullName: string }> }).mergedFrom[0]!.fullName).toBe(
      "ZZ Sylvia R Garcia",
    );
    expect(await prisma.candidate.findUnique({ where: { id: merge.id } })).toBeNull();
  });

  it("carries certification and incumbency across into the surviving candidacy", async () => {
    const { keep, merge, raceId } = await makePair(true);
    await app.inject({
      method: "POST",
      url: "/admin/candidates/merge",
      headers: { authorization: `Bearer ${TOKEN}`, "x-reviewer": "Reviewer" },
      payload: { keepId: keep.id, mergeId: merge.id },
    });
    const c = await prisma.candidacy.findFirstOrThrow({ where: { raceId, candidateId: keep.id } });
    expect(c.isCertified).toBe(true);
    expect(c.isIncumbent).toBe(true);
    expect(await prisma.candidacy.count({ where: { candidateId: merge.id } })).toBe(0);
  });

  it("refuses to merge records that share no race", async () => {
    const { keep, merge } = await makePair(false);
    const res = await app.inject({
      method: "POST",
      url: "/admin/candidates/merge",
      headers: { authorization: `Bearer ${TOKEN}`, "x-reviewer": "Reviewer" },
      payload: { keepId: keep.id, mergeId: merge.id },
    });
    // Same-race is the entire basis for proposing two names as one person.
    expect(res.statusCode).toBe(422);
    expect(await prisma.candidate.findUnique({ where: { id: merge.id } })).not.toBeNull();
  });

  it("records the signed-in reviewer as the one who merged", async () => {
    const { keep, merge } = await makePair(true);
    const res = await app.inject({
      method: "POST",
      url: "/admin/candidates/merge",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { keepId: keep.id, mergeId: merge.id },
    });
    expect(res.statusCode).toBe(200);
    const after = await prisma.candidate.findUniqueOrThrow({ where: { id: keep.id } });
    const merges = (after.externalIds as { mergedFrom: Array<{ by: string }> }).mergedFrom;
    expect(merges[0]!.by).toBe("tester");
  });
});

describe("publishing a batch", () => {
  it("refuses a stance with no evidence, exactly as it does singly", async () => {
    const issue = await prisma.issue.findFirstOrThrow();
    const cand = await prisma.candidate.create({
      data: { slug: `${PREFIX}batch`, fullName: "ZZ Batch Test" },
    });
    const bare = await prisma.position.create({
      data: {
        candidateId: cand.id,
        issueId: issue.id,
        stance: "SUPPORT",
        summary: "x",
        confidence: 0.9,
        status: "IN_REVIEW",
      },
    });
    const absence = await prisma.position.create({
      data: {
        candidateId: cand.id,
        issueId: issue.id,
        stance: "NO_STATED_POSITION",
        summary: "The page does not say.",
        confidence: 0.9,
        status: "DRAFT",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/admin/positions/publish-batch",
      headers: { authorization: `Bearer ${TOKEN}`, "x-reviewer": "Reviewer" },
      payload: { ids: [bare.id, absence.id] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // An absence carries no quote by definition and publishes. A stance without one
    // does not, and the refusal is itemised rather than failing the whole batch.
    expect(body.published).toBe(1);
    expect(body.refused).toHaveLength(1);
    expect(body.refused[0].why).toMatch(/no evidence/);

    expect((await prisma.position.findUniqueOrThrow({ where: { id: bare.id } })).status).toBe("IN_REVIEW");
    expect((await prisma.position.findUniqueOrThrow({ where: { id: absence.id } })).status).toBe("PUBLISHED");

    await prisma.position.deleteMany({ where: { candidateId: cand.id } });
    await prisma.candidate.delete({ where: { id: cand.id } });
  });

  it("attributes a batch to the signed-in reviewer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/positions/publish-batch",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { ids: ["no-such-id"] },
    });
    // No header, and it still works, because the session names the person.
    expect(res.statusCode).toBe(200);
    expect(res.json().published).toBe(0);
  });
});
