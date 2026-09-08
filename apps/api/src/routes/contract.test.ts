import { prisma } from "@civic/db";
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

describe("address to ballot", () => {
  it("returns only races whose district the address is in, and names what is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ballot",
      payload: { address: "1500 Marilla St, Dallas, TX 75201" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // A congressional race for a district this address is not in is not this
    // voter's race, however much data we hold for it.
    const cd = body.districts.congressional as string;
    const house = body.ballot
      .flatMap((e: { races: Array<{ office: string; seat: string }> }) => e.races)
      .filter((r: { office: string }) => r.office === "United States Representative");
    for (const r of house) expect(cd).toContain(r.seat);

    // Coverage is stated, never implied. A short ballot must not read as a whole one.
    expect(body.coverageNote).toMatch(/not your whole ballot|do not yet cover/);
    expect(Array.isArray(body.notCovered)).toBe(true);
  }, 30000);

  it("never returns the address it was given, only what the geocoder matched", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ballot",
      payload: { address: "1500 Marilla St, Dallas, TX 75201" },
    });
    const raw = res.body;
    // The submitted string is not echoed anywhere in the response. The matched
    // address is the geocoder's normalisation, which is a different thing.
    expect(raw).not.toContain("1500 Marilla St, Dallas, TX 75201");
    expect(res.json().matched).toBeTruthy();
  }, 30000);

  it("says why an address failed rather than returning an empty ballot", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ballot",
      payload: { address: "not a real address at all zzz" },
    });
    // An empty ballot for a bad address reads as "you have no elections".
    expect(res.statusCode).toBe(404);
    expect(res.json().why).toMatch(/geocoder/i);
  }, 30000);
});

describe("the quiz asks the same questions the positions answer", () => {
  it("serves propositions, not the old seeded prompts", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/elections/2026-11-tx/quiz" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.questions.length).toBeGreaterThan(0);

    // Every question must be a live proposition. Matching a voter's answers against
    // a different set of questions than the positions were extracted for compares
    // two different things and calls the result agreement.
    const live = await prisma.proposition.findMany({
      where: { isCurrent: true },
      select: { text: true, issue: { select: { slug: true } } },
    });
    const byText = new Map(live.map((p: { text: string; issue: { slug: string } }) => [p.text, p.issue.slug]));
    for (const q of body.questions as Array<{ prompt: string; issueSlug: string }>) {
      expect(byText.get(q.prompt)).toBe(q.issueSlug);
    }
  });

  it("gives both readings, so neither answer is the implied one", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/elections/2026-11-tx/quiz" });
    for (const q of res.json().questions as Array<{ yesMeans: string; noMeans: string }>) {
      expect(q.yesMeans?.length).toBeGreaterThan(0);
      expect(q.noMeans?.length).toBeGreaterThan(0);
    }
  });

  it("only asks about issues this election's offices can act on", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/elections/2026-11-tx/quiz" });
    const slugs = (res.json().questions as Array<{ issueSlug: string }>).map((q) => q.issueSlug);
    // Texas November 2026 is federal only in this dataset, so a purely local
    // question has no candidate who could answer it.
    expect(slugs).not.toContain("local-development-zoning");
  });
});
