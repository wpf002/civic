import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@civic/db";
import { matchCandidates } from "@civic/core";

// Read-only. Only PUBLISHED positions ever leave this process.
export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/issues", async () => prisma.issue.findMany({ orderBy: { sortOrder: "asc" } }));

  app.get("/elections/upcoming", async () =>
    prisma.election.findMany({ where: { electionDate: { gte: new Date() } }, orderBy: { electionDate: "asc" } }),
  );

  app.get("/candidates/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const c = await prisma.candidate.findUnique({
      where: { slug },
      include: {
        candidacies: { include: { race: { include: { office: true, election: true } }, party: true } },
        positions: { where: { status: "PUBLISHED" }, include: { issue: true, evidence: { include: { source: true } } } },
      },
    });
    if (!c) return reply.code(404).send({ error: "not found" });
    return c;
  });

  app.get("/issues/:slug/candidates", async (req) => {
    const { slug } = req.params as { slug: string };
    const q = z.object({ electionId: z.string() }).parse(req.query);
    return prisma.position.findMany({
      where: { status: "PUBLISHED", issue: { slug }, candidate: { candidacies: { some: { race: { electionId: q.electionId } } } } },
      include: { candidate: true, evidence: { include: { source: true } } },
    });
  });

  // Stateless. Answers are never stored.
  app.post("/match", async (req) => {
    const body = z.object({
      electionId: z.string(),
      answers: z.array(z.object({ issueSlug: z.string(), value: z.number().int().min(-2).max(2), weight: z.number().int().min(1).max(3) })),
    }).parse(req.body);
    const positions = await prisma.position.findMany({
      where: { status: "PUBLISHED", candidate: { candidacies: { some: { race: { electionId: body.electionId } } } } },
      select: { candidateId: true, stance: true, issue: { select: { slug: true } } },
    });
    return matchCandidates(
      body.answers as never,
      positions.map((p) => ({ candidateId: p.candidateId, issueSlug: p.issue.slug, stance: p.stance })),
    );
  });

  app.post("/report", async (req) => {
    const body = z.object({ targetType: z.enum(["position", "candidate"]), targetId: z.string(), message: z.string().max(1000) }).parse(req.body);
    const { createHash } = await import("node:crypto");
    await prisma.userReport.create({ data: { ...body, ipHash: createHash("sha256").update(req.ip).digest("hex") } });
    return { ok: true };
  });
};
