import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "@civic/db";
import { matchCandidates } from "@civic/core";

/**
 * Read-only. Only PUBLISHED positions ever leave this process — enforced in every
 * query here, never in the UI. `contract.test.ts` asserts it against the fixture.
 */

/** Reused everywhere a position is returned, so the shape a reader learns holds on every route. */
const positionSelect = {
  id: true,
  stance: true,
  summary: true,
  confidence: true,
  publishedAt: true,
  supersedesId: true,
  issue: { select: { slug: true, name: true, description: true, sortOrder: true } },
  evidence: {
    select: {
      id: true,
      quote: true,
      startOffset: true,
      endOffset: true,
      mediaTimestamp: true,
      source: {
        select: {
          id: true,
          url: true,
          title: true,
          publisher: true,
          kind: true,
          tier: true,
          capturedAt: true,
          publishedAt: true,
          text: true,
        },
      },
    },
  },
} satisfies Prisma.PositionSelect;

const PUBLISHED = { status: "PUBLISHED" } as const;
const SILENT = ["NO_STATED_POSITION", "DECLINED_TO_STATE"] as const;

/** ~40 words of the archived source around the verified span. Context is what survives a challenge. */
function withContext(text: string, start: number, end: number, pad = 220) {
  const from = Math.max(0, start - pad);
  const to = Math.min(text.length, end + pad);
  return {
    before: (from > 0 ? "…" : "") + text.slice(from, start),
    span: text.slice(start, end),
    after: text.slice(end, to) + (to < text.length ? "…" : ""),
  };
}

type EvidenceRow = { quote: string; startOffset: number; endOffset: number; source: { text: string } };

function shapePosition<T extends { evidence: EvidenceRow[] }>(p: T) {
  return {
    ...p,
    evidence: p.evidence.map((e) => {
      const { text, ...source } = e.source as EvidenceRow["source"] & Record<string, unknown>;
      return { ...e, source, context: withContext(text, e.startOffset, e.endOffset) };
    }),
  };
}

export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/issues", async () => prisma.issue.findMany({ orderBy: { sortOrder: "asc" } }));

  app.get("/elections/upcoming", async () =>
    prisma.election.findMany({
      where: { electionDate: { gte: new Date() } },
      orderBy: { electionDate: "asc" },
    }),
  );

  /** Elections that have something to show. An election with no published data does not render. */
  app.get("/elections", async () => {
    const elections = await prisma.election.findMany({ orderBy: { electionDate: "asc" } });
    const out = [];
    for (const e of elections) {
      const where = { race: { electionId: e.id } };
      const [candidates, races, positions, silent] = await Promise.all([
        prisma.candidacy.count({ where }),
        prisma.race.count({ where: { electionId: e.id } }),
        prisma.position.count({
          where: { ...PUBLISHED, candidate: { candidacies: { some: where } } },
        }),
        prisma.position.count({
          where: {
            ...PUBLISHED,
            stance: { in: [...SILENT] },
            candidate: { candidacies: { some: where } },
          },
        }),
      ]);
      if (positions === 0) continue;
      out.push({ ...e, counts: { races, candidates, positions, silent, stated: positions - silent } });
    }
    return out;
  });

  /** The issue grid for one election, with the honesty counts up front. */
  app.get("/elections/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const election = await prisma.election.findUnique({
      where: { slug },
      include: {
        races: {
          include: {
            office: { include: { jurisdiction: true, district: true } },
            _count: { select: { candidacies: true } },
          },
        },
      },
    });
    if (!election) return reply.code(404).send({ error: "not found" });

    const inElection = { candidacies: { some: { race: { electionId: election.id } } } };
    const positions = await prisma.position.findMany({
      where: { ...PUBLISHED, candidate: inElection },
      select: { stance: true, candidateId: true, issue: { select: { slug: true } } },
    });

    const levels = new Set(election.races.map((r) => r.office.jurisdiction.level));
    const issues = await prisma.issue.findMany({ orderBy: { sortOrder: "asc" } });

    const byIssue = new Map<string, { stances: string[]; candidates: Set<string> }>();
    for (const p of positions) {
      const e = byIssue.get(p.issue.slug) ?? { stances: [], candidates: new Set<string>() };
      e.stances.push(p.stance);
      e.candidates.add(p.candidateId);
      byIssue.set(p.issue.slug, e);
    }

    return {
      ...election,
      counts: {
        races: election.races.length,
        candidates: election.races.reduce((n, r) => n + r._count.candidacies, 0),
        positions: positions.length,
        silent: positions.filter((p) => (SILENT as readonly string[]).includes(p.stance)).length,
      },
      // Ordered by the taxonomy's editorial sortOrder, deliberately NOT by stance divergence:
      // divergence can only be measured over filled cells, so it would make the default order
      // depend on which candidates generate the most extractable text. See docs/DESIGN.md §6.
      issues: issues
        .filter((i) => i.levels.some((l) => levels.has(l)))
        .map((i) => {
          const e = byIssue.get(i.slug);
          const stances = e?.stances ?? [];
          const silent = stances.filter((s) => (SILENT as readonly string[]).includes(s));
          return {
            slug: i.slug,
            name: i.name,
            description: i.description,
            candidates: e?.candidates.size ?? 0,
            stated: stances.length - silent.length,
            silent: silent.length,
            distinctStances: new Set(stances.filter((s) => !(SILENT as readonly string[]).includes(s)))
              .size,
          };
        }),
    };
  });

  /** The product: every candidate in the election on one issue, in ballot order. */
  app.get("/elections/:slug/issues/:issueSlug", async (req, reply) => {
    const { slug, issueSlug } = req.params as { slug: string; issueSlug: string };
    const [election, issue] = await Promise.all([
      prisma.election.findUnique({ where: { slug } }),
      prisma.issue.findUnique({ where: { slug: issueSlug } }),
    ]);
    if (!election || !issue) return reply.code(404).send({ error: "not found" });

    const candidacies = await prisma.candidacy.findMany({
      where: { race: { electionId: election.id } },
      include: {
        party: true,
        race: { include: { office: { include: { jurisdiction: true, district: true } } } },
        candidate: {
          include: {
            positions: { where: { ...PUBLISHED, issueId: issue.id }, select: positionSelect },
            // Every document we hold for this candidate. What makes an absence provable.
            sources: {
              select: { id: true, title: true, url: true, kind: true, tier: true, capturedAt: true },
              orderBy: { capturedAt: "desc" },
            },
          },
        },
      },
      // Ballot order, then a stable id tiebreak. Never alphabetical: rank 1 is worth
      // 2-6 points of vote probability, so ordering is an intervention.
      orderBy: [{ ballotOrder: "asc" }, { id: "asc" }],
    });

    // Issue-per-office. A DISD trustee does not set housing policy, and listing one
    // under Housing as "no stated position" invents a silence that was never a question.
    const inScope = candidacies.filter((c) =>
      (issue.levels as string[]).includes(c.race.office.jurisdiction.level),
    );
    const applies = inScope.length > 0;

    return {
      election: { slug: election.slug, name: election.name, electionDate: election.electionDate },
      issue,
      appliesToThisBallot: applies,
      races: [
        ...new Map(
          inScope.map((c) => [
            c.race.id,
            {
              id: c.race.id,
              office: c.race.office.title,
              district: c.race.office.district?.name ?? null,
              jurisdiction: c.race.office.jurisdiction.name,
              level: c.race.office.jurisdiction.level,
            },
          ]),
        ).values(),
      ],
      candidates: inScope.map((c) => {
        const position = c.candidate.positions[0];
        return {
          slug: c.candidate.slug,
          fullName: c.candidate.fullName,
          party: c.party ? { name: c.party.name, abbreviation: c.party.abbreviation } : null,
          isIncumbent: c.isIncumbent,
          ballotOrder: c.ballotOrder,
          raceId: c.raceId,
          position: position ? shapePosition(position) : null,
          // The Silence Receipt's evidence: what we read, and when.
          sourcesRead: c.candidate.sources,
        };
      }),
    };
  });

  /** One candidate's whole record, with coverage stated before any position. */
  app.get("/candidates/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const c = await prisma.candidate.findUnique({
      where: { slug },
      include: {
        candidacies: {
          include: {
            party: true,
            race: {
              include: {
                election: true,
                office: { include: { jurisdiction: true, district: true } },
              },
            },
          },
        },
        incumbencies: { include: { office: true } },
        positions: { where: PUBLISHED, select: positionSelect, orderBy: { issue: { sortOrder: "asc" } } },
        sources: {
          select: { id: true, title: true, url: true, kind: true, tier: true, capturedAt: true },
          orderBy: { capturedAt: "desc" },
        },
        votes: { orderBy: { votedAt: "desc" }, take: 50 },
      },
    });
    if (!c) return reply.code(404).send({ error: "not found" });

    const levels = new Set(c.candidacies.map((cy) => cy.race.office.jurisdiction.level));
    const applicable = await prisma.issue.findMany({ orderBy: { sortOrder: "asc" } });
    const applies = applicable.filter((i) => i.levels.some((l) => levels.has(l)));
    const byIssue = new Map(c.positions.map((p) => [p.issue.slug, p]));

    return {
      slug: c.slug,
      fullName: c.fullName,
      websiteUrl: c.websiteUrl,
      bio: c.bio,
      candidacies: c.candidacies.map((cy) => ({
        electionSlug: cy.race.election.slug,
        electionName: cy.race.election.name,
        electionDate: cy.race.election.electionDate,
        office: cy.race.office.title,
        district: cy.race.office.district?.name ?? null,
        jurisdiction: cy.race.office.jurisdiction.name,
        termYears: cy.race.office.termYears,
        party: cy.party ? { name: cy.party.name, abbreviation: cy.party.abbreviation } : null,
        isIncumbent: cy.isIncumbent,
        ballotOrder: cy.ballotOrder,
      })),
      // One tick per issue that applies to this office. Sparsity is disclosure, not thin content.
      coverage: applies.map((i) => {
        const p = byIssue.get(i.slug);
        return {
          slug: i.slug,
          name: i.name,
          state: !p
            ? ("unattempted" as const)
            : (SILENT as readonly string[]).includes(p.stance)
              ? ("silent" as const)
              : ("stated" as const),
        };
      }),
      positions: c.positions.map(shapePosition),
      sourcesRead: c.sources,
      votes: c.votes,
    };
  });

  /** Questions plus the published stances needed to score them. Nothing about the user. */
  app.get("/elections/:slug/quiz", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const election = await prisma.election.findUnique({ where: { slug } });
    if (!election) return reply.code(404).send({ error: "not found" });

    const inElection = { candidacies: { some: { race: { electionId: election.id } } } };
    const [questions, positions, candidacies] = await Promise.all([
      prisma.quizQuestion.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
        include: { issue: { select: { slug: true, name: true, description: true } } },
      }),
      prisma.position.findMany({
        where: { ...PUBLISHED, candidate: inElection },
        select: {
          id: true,
          stance: true,
          summary: true,
          candidate: { select: { slug: true, fullName: true } },
          issue: { select: { slug: true } },
        },
      }),
      prisma.candidacy.findMany({
        where: { race: { electionId: election.id } },
        orderBy: [{ ballotOrder: "asc" }, { id: "asc" }],
        include: {
          party: true,
          candidate: { select: { slug: true, fullName: true } },
          race: { include: { office: { include: { district: true } } } },
        },
      }),
    ]);

    return {
      election: { slug: election.slug, name: election.name, electionDate: election.electionDate },
      questions: questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        issueSlug: q.issue.slug,
        issueName: q.issue.name,
        issueDescription: q.issue.description,
      })),
      candidates: candidacies.map((c) => ({
        slug: c.candidate.slug,
        fullName: c.candidate.fullName,
        party: c.party?.abbreviation ?? null,
        isIncumbent: c.isIncumbent,
        ballotOrder: c.ballotOrder,
        office: c.race.office.title,
        district: c.race.office.district?.name ?? null,
      })),
      positions: positions.map((p) => ({
        candidateSlug: p.candidate.slug,
        issueSlug: p.issue.slug,
        stance: p.stance,
        summary: p.summary,
        positionId: p.id,
      })),
    };
  });

  /** Stateless. Answers are never stored, and nothing here is logged. */
  app.post("/match", async (req) => {
    const body = z
      .object({
        electionSlug: z.string(),
        answers: z.array(
          z.object({
            issueSlug: z.string(),
            value: z.number().int().min(-2).max(2),
            weight: z.number().int().min(1).max(3),
          }),
        ),
      })
      .parse(req.body);

    const election = await prisma.election.findUnique({ where: { slug: body.electionSlug } });
    if (!election) return { results: [] };

    const positions = await prisma.position.findMany({
      where: {
        ...PUBLISHED,
        candidate: { candidacies: { some: { race: { electionId: election.id } } } },
      },
      select: { candidateId: true, stance: true, issue: { select: { slug: true } } },
    });

    const results = matchCandidates(
      body.answers as never,
      positions.map((p) => ({
        candidateId: p.candidateId,
        issueSlug: p.issue.slug,
        stance: p.stance,
      })),
    );
    const names = await prisma.candidate.findMany({
      where: { id: { in: results.map((r) => r.candidateId) } },
      select: { id: true, slug: true, fullName: true },
    });
    const byId = new Map(names.map((n) => [n.id, n]));
    return {
      results: results.map((r) => ({
        ...r,
        slug: byId.get(r.candidateId)?.slug ?? null,
        fullName: byId.get(r.candidateId)?.fullName ?? null,
      })),
    };
  });

  app.post("/report", async (req) => {
    const body = z
      .object({
        targetType: z.enum(["position", "candidate"]),
        targetId: z.string(),
        message: z.string().max(1000),
      })
      .parse(req.body);
    const { createHash } = await import("node:crypto");
    await prisma.userReport.create({
      data: { ...body, ipHash: createHash("sha256").update(req.ip).digest("hex") },
    });
    return { ok: true };
  });

  /** The corrections log. supersedesId is the best thing in the data model; make it visible. */
  app.get("/corrections", async () => {
    const superseded = await prisma.position.findMany({
      where: { status: "SUPERSEDED" },
      orderBy: { capturedAt: "desc" },
      take: 200,
      select: {
        id: true,
        stance: true,
        summary: true,
        capturedAt: true,
        candidate: { select: { slug: true, fullName: true } },
        issue: { select: { slug: true, name: true } },
        supersededBy: { select: { id: true, stance: true, summary: true, publishedAt: true } },
      },
    });
    return superseded;
  });
};
