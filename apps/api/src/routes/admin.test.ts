import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "@civic/db";
import { adminRoutes } from "./admin.js";

/**
 * The rule under test: a candidate never leaves a ballot without a document.
 */
const TOKEN = "test-admin-token";
const AUTH = { authorization: `Bearer ${TOKEN}`, "x-reviewer": "tester" };
const PREFIX = "zz-admin-test-";

let app: FastifyInstance;
let raceId: string;

beforeAll(async () => {
  process.env.ADMIN_TOKEN = TOKEN;
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
  if (mine.length) await prisma.candidacy.deleteMany({ where: { candidateId: { in: mine.map((m) => m.id) } } });
  await prisma.candidate.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.rosterDiff.deleteMany({ where: { raceId } });
  await prisma.rosterSnapshot.deleteMany({ where: { raceId } });
  await prisma.reviewTask.deleteMany({ where: { reason: { contains: PREFIX } } });
}

beforeEach(purge);
afterAll(async () => {
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

  it("refuses to run at all on the placeholder token", async () => {
    process.env.ADMIN_TOKEN = "change-me";
    const r = await app.inject({ url: "/admin/queue", headers: AUTH });
    expect(r.statusCode).toBe(503);
    process.env.ADMIN_TOKEN = TOKEN;
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

  it("requires a named reviewer", async () => {
    const diff = await quarantinedRemoval();
    const r = await app.inject({
      method: "POST",
      url: `/admin/roster-diffs/${diff.id}/accept`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { artifactUrl: "https://example.org/x.pdf" },
    });
    expect(r.statusCode).toBe(400);
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
