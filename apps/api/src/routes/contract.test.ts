import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { publicRoutes } from "./public.js";

/**
 * CLAUDE.md: only PUBLISHED positions are readable from /v1, enforced in the query.
 * This asserts it against the real fixture database rather than trusting the reviewer.
 */
let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(publicRoutes, { prefix: "/v1" });
  await app.ready();
});
afterAll(async () => app?.close());

const STATUSES_THAT_MUST_NEVER_LEAK = ["DRAFT", "IN_REVIEW", "REJECTED", "SUPERSEDED"];

describe("/v1 never returns a non-PUBLISHED position", () => {
  it("issue comparison", async () => {
    const r = await app.inject({ url: "/v1/elections/2027-11-dallas/issues/housing-cost-of-living" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.candidates.length).toBeGreaterThan(0);
    for (const c of body.candidates) {
      if (c.position) expect(STATUSES_THAT_MUST_NEVER_LEAK).not.toContain(c.position.status);
    }
    // The payload must not carry status at all — nothing downstream can filter on it.
    expect(JSON.stringify(body)).not.toMatch(/"status":"(DRAFT|IN_REVIEW|REJECTED)"/);
  });

  it("candidate record", async () => {
    const r = await app.inject({ url: "/v1/candidates/marisela-ochoa" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.positions.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/"status":"(DRAFT|IN_REVIEW|REJECTED)"/);
  });
});

describe("evidence", () => {
  it("returns the quote inside its archived context, and the context contains the span", async () => {
    const r = await app.inject({ url: "/v1/elections/2027-11-dallas/issues/housing-cost-of-living" });
    const withEvidence = r
      .json()
      .candidates.filter((c: any) => c.position?.evidence?.length)
      .flatMap((c: any) => c.position.evidence);
    expect(withEvidence.length).toBeGreaterThan(0);
    for (const e of withEvidence) {
      expect(e.context.span).toBe(e.quote);
      expect(e.source.text).toBeUndefined(); // the whole document does not ship to the client
    }
  });
});

describe("ordering", () => {
  it("is ballot order, never alphabetical", async () => {
    const body = (
      await app.inject({ url: "/v1/elections/2027-11-dallas/issues/housing-cost-of-living" })
    ).json();
    const orders = body.candidates.map((c: any) => c.ballotOrder);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    const names = body.candidates.map((c: any) => c.fullName);
    expect(names).not.toEqual([...names].sort());
  });
});

describe("silence", () => {
  it("distinguishes a refusal from an absence, and carries the sources read", async () => {
    const body = (
      await app.inject({ url: "/v1/elections/2027-11-dallas/issues/civil-rights" })
    ).json();
    const stances = body.candidates.map((c: any) => c.position?.stance);
    expect(stances).toContain("DECLINED_TO_STATE");
    expect(stances).toContain("NO_STATED_POSITION");
    const silent = body.candidates.find((c: any) => c.position?.stance === "NO_STATED_POSITION");
    expect(Array.isArray(silent.sourcesRead)).toBe(true);
  });
});

describe("/match", () => {
  it("is stateless and returns coverage alongside score", async () => {
    const payload = {
      electionSlug: "2027-11-dallas",
      answers: [
        { issueSlug: "housing-cost-of-living", value: 2, weight: 3 },
        { issueSlug: "taxes-budget", value: -2, weight: 1 },
      ],
    };
    const a = await app.inject({ method: "POST", url: "/v1/match", payload });
    const b = await app.inject({ method: "POST", url: "/v1/match", payload });
    expect(a.json()).toEqual(b.json()); // deterministic
    for (const r of a.json().results) {
      expect(r).toHaveProperty("coverage");
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("issue-per-office", () => {
  // A manufactured silence is worse than a gap: it counts a candidate as declining to
  // answer a question their office has no power over.
  it("only lists candidates whose office is at a level the issue applies to", async () => {
    const housing = (
      await app.inject({ url: "/v1/elections/2027-11-dallas/issues/housing-cost-of-living" })
    ).json();
    expect(housing.races.map((r: any) => r.office)).toEqual(["Dallas City Council Member"]);

    const education = (
      await app.inject({ url: "/v1/elections/2027-11-dallas/issues/education-k12" })
    ).json();
    expect(education.races.map((r: any) => r.office)).toEqual(["Dallas ISD Trustee"]);

    // Both bodies set a tax rate, so both belong here.
    const taxes = (
      await app.inject({ url: "/v1/elections/2027-11-dallas/issues/taxes-budget" })
    ).json();
    expect(taxes.races).toHaveLength(2);
  });
});

describe("coverage", () => {
  it("counts a refusal separately from silence", async () => {
    const c = (await app.inject({ url: "/v1/candidates/june-halvorsen" })).json();
    const states = c.coverage.reduce((acc: any, x: any) => {
      acc[x.state] = (acc[x.state] ?? 0) + 1;
      return acc;
    }, {});
    // Halvorsen answered one issue, was silent on one, and refused on one.
    expect(states.declined).toBe(1);
    expect(states.silent).toBe(1);
    expect(states.stated).toBe(1);
  });
});
