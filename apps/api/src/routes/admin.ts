import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@civic/db";

/**
 * Review console backend.
 *
 * Token auth in v0. This must be replaced with real auth before the pilot — it is
 * listed in the roadmap's security workstream and it is not done.
 *
 * The rule this file exists to enforce: a roster change that removes a candidate can
 * only be accepted with a document attached. The pipeline quarantines the removal;
 * this is where a person supplies the Certificate of Withdrawal, the Order of
 * Cancellation, or the certified ballot that omits the name. There is no endpoint
 * that removes a candidate without one.
 */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (req, reply) => {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || expected === "change-me") {
      return reply.code(503).send({ error: "ADMIN_TOKEN is not configured" });
    }
    if (req.headers.authorization !== `Bearer ${expected}`) return reply.code(401).send();
  });

  const reviewer = (req: { headers: Record<string, unknown> }) =>
    (req.headers["x-reviewer"] as string | undefined)?.trim() || null;

  // ---------------------------------------------------------------- queue

  app.get("/queue", async () => {
    const [tasks, diffs, drafts, runs] = await Promise.all([
      prisma.reviewTask.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
      prisma.rosterDiff.findMany({
        where: { verdict: "QUARANTINED" },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          race: {
            include: {
              election: { select: { slug: true, name: true } },
              office: { include: { district: true, jurisdiction: true } },
            },
          },
          toSnapshot: true,
          fromSnapshot: true,
        },
      }),
      prisma.position.findMany({
        where: { status: { in: ["DRAFT", "IN_REVIEW"] } },
        orderBy: { capturedAt: "asc" },
        take: 100,
        include: {
          candidate: { select: { slug: true, fullName: true } },
          issue: { select: { slug: true, name: true } },
          evidence: { include: { source: { select: { url: true, title: true, capturedAt: true } } } },
        },
      }),
      prisma.ingestRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
    ]);

    return {
      counts: {
        tasks: tasks.length,
        quarantinedDiffs: diffs.length,
        draftPositions: drafts.length,
      },
      tasks,
      rosterDiffs: diffs.map((d) => ({
        id: d.id,
        createdAt: d.createdAt,
        added: d.added,
        removed: d.removed,
        verdict: d.verdict,
        // A removal is the case that needs a document. Say so in the payload.
        requiresArtifact: d.removed.length > 0,
        race: {
          id: d.race.id,
          office: d.race.office.title,
          district: d.race.office.district?.name ?? null,
          election: d.race.election.slug,
        },
        before: d.fromSnapshot?.candidateCount ?? 0,
        after: d.toSnapshot.candidateCount,
        sourceUrl: d.toSnapshot.sourceUrl,
        observedAt: d.toSnapshot.observedAt,
        payload: d.toSnapshot.payload,
      })),
      draftPositions: drafts,
      recentRuns: runs,
    };
  });

  // ---------------------------------------------------------------- rosters

  app.post("/roster-diffs/:id/accept", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        /** The document that justifies a removal. Required whenever anything is removed. */
        artifactUrl: z.string().url().optional(),
        note: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});

    const who = reviewer(req);
    if (!who) return reply.code(400).send({ error: "x-reviewer header is required" });

    const diff = await prisma.rosterDiff.findUnique({
      where: { id },
      include: { toSnapshot: true, race: true },
    });
    if (!diff) return reply.code(404).send({ error: "not found" });
    if (diff.verdict !== "QUARANTINED") {
      return reply.code(409).send({ error: `diff is already ${diff.verdict}` });
    }

    // The rule. A candidate never leaves without a document.
    if (diff.removed.length > 0 && !body.artifactUrl) {
      return reply.code(422).send({
        error: "artifactUrl is required to accept a removal",
        removed: diff.removed,
        why:
          "A candidate can only be removed with the document that justifies it — a Certificate " +
          "of Withdrawal, an Order of Cancellation, or a certified ballot that omits the name.",
      });
    }

    const applied = await prisma.$transaction(async (tx) => {
      const entries = readEntries(diff.toSnapshot.payload);
      const keep = new Set(entries.filter((e) => !e.isPlaceholder).map((e) => e.key));

      // Additions and refreshes.
      for (const e of entries) {
        if (e.isPlaceholder) continue;
        const slug = e.key.replace(/\s+/g, "-");
        const cand = await tx.candidate.upsert({
          where: { slug },
          update: { fullName: e.name },
          create: { slug, fullName: e.name },
        });
        await tx.candidacy.upsert({
          where: { raceId_candidateId: { raceId: diff.raceId, candidateId: cand.id } },
          update: {
            lastObservedAt: new Date(),
            observedSourceUrl: diff.toSnapshot.sourceUrl,
            ...(e.ballotOrder != null ? { ballotOrder: e.ballotOrder } : {}),
          },
          create: {
            raceId: diff.raceId,
            candidateId: cand.id,
            status: "DECLARED",
            isWriteIn: !!e.isWriteIn,
            firstObservedAt: new Date(),
            lastObservedAt: new Date(),
            observedSourceUrl: diff.toSnapshot.sourceUrl,
            ...(e.ballotOrder != null ? { ballotOrder: e.ballotOrder } : {}),
          },
        });
      }

      // Removals: marked WITHDRAWN with the artifact recorded. The row is never deleted,
      // so the history of who was on the ballot stays intact.
      let withdrawn = 0;
      if (diff.removed.length > 0) {
        const current = await tx.candidacy.findMany({
          where: { raceId: diff.raceId },
          include: { candidate: true },
        });
        for (const c of current) {
          const key = c.candidate.slug.replace(/-/g, " ");
          if (keep.has(c.candidate.slug) || keep.has(key)) continue;
          if (!diff.removed.includes(c.candidate.fullName)) continue;
          await tx.candidacy.update({
            where: { id: c.id },
            data: {
              status: "WITHDRAWN",
              withdrawnAt: new Date(),
              withdrawalSourceUrl: body.artifactUrl!,
            },
          });
          withdrawn++;
        }
      }

      await tx.rosterSnapshot.update({ where: { id: diff.toSnapshotId }, data: { accepted: true } });
      await tx.rosterDiff.update({
        where: { id },
        data: { verdict: "ACCEPTED", decidedBy: who, decidedAt: new Date() },
      });
      await tx.reviewTask.updateMany({
        where: { targetId: diff.toSnapshotId, resolvedAt: null },
        data: {
          resolvedAt: new Date(),
          resolution: `Accepted by ${who}${body.artifactUrl ? ` with ${body.artifactUrl}` : ""}${body.note ? ` — ${body.note}` : ""}`,
        },
      });
      return { withdrawn, kept: keep.size };
    });

    return { ok: true, ...applied };
  });

  app.post("/roster-diffs/:id/reject", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ note: z.string().max(500) }).parse(req.body ?? {});
    const who = reviewer(req);
    if (!who) return reply.code(400).send({ error: "x-reviewer header is required" });

    await prisma.rosterDiff.update({
      where: { id },
      data: { verdict: "REJECTED", decidedBy: who, decidedAt: new Date() },
    });
    const diff = await prisma.rosterDiff.findUniqueOrThrow({ where: { id } });
    await prisma.reviewTask.updateMany({
      where: { targetId: diff.toSnapshotId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolution: `Rejected by ${who} — ${body.note}` },
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- positions

  app.post("/positions/:id/publish", async (req, reply) => {
    const { id } = req.params as { id: string };
    const who = reviewer(req);
    if (!who) return reply.code(400).send({ error: "x-reviewer header is required" });

    const position = await prisma.position.findUnique({
      where: { id },
      include: { evidence: true },
    });
    if (!position) return reply.code(404).send({ error: "not found" });
    if (position.status === "PUBLISHED") return reply.code(409).send({ error: "already published" });

    // Every published position needs evidence, unless it is an absence — which by
    // definition has no quote to carry.
    const isAbsence =
      position.stance === "NO_STATED_POSITION" || position.stance === "DECLINED_TO_STATE";
    if (!isAbsence && position.evidence.length === 0) {
      return reply.code(422).send({
        error: "a position with a stance cannot be published without at least one evidence row",
      });
    }

    return prisma.position.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        reviewedBy: who,
        reviewedAt: new Date(),
        publishedAt: new Date(),
      },
    });
  });

  app.post("/positions/:id/reject", async (req, reply) => {
    const { id } = req.params as { id: string };
    const who = reviewer(req);
    if (!who) return reply.code(400).send({ error: "x-reviewer header is required" });
    return prisma.position.update({
      where: { id },
      data: { status: "REJECTED", reviewedBy: who, reviewedAt: new Date() },
    });
  });

  /**
   * Correct a published position.
   *
   * Never an edit. Publishes a new row pointing at the old one and marks the old row
   * SUPERSEDED, so the public corrections log can show both.
   */
  app.post("/positions/:id/supersede", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        stance: z.enum([
          "STRONG_SUPPORT",
          "SUPPORT",
          "MIXED",
          "OPPOSE",
          "STRONG_OPPOSE",
          "NO_STATED_POSITION",
          "DECLINED_TO_STATE",
        ]),
        summary: z.string().max(600),
        evidenceIds: z.array(z.string()).default([]),
      })
      .parse(req.body);
    const who = reviewer(req);
    if (!who) return reply.code(400).send({ error: "x-reviewer header is required" });

    const old = await prisma.position.findUnique({ where: { id } });
    if (!old) return reply.code(404).send({ error: "not found" });
    if (old.status !== "PUBLISHED") {
      return reply.code(409).send({ error: "only a PUBLISHED position can be superseded" });
    }

    return prisma.$transaction(async (tx) => {
      const next = await tx.position.create({
        data: {
          candidateId: old.candidateId,
          issueId: old.issueId,
          stance: body.stance,
          summary: body.summary,
          confidence: old.confidence,
          status: "PUBLISHED",
          extractedBy: "human",
          reviewedBy: who,
          reviewedAt: new Date(),
          publishedAt: new Date(),
          supersedesId: old.id,
          ...(body.evidenceIds.length
            ? { evidence: { connect: body.evidenceIds.map((e) => ({ id: e })) } }
            : {}),
        },
      });
      await tx.position.update({ where: { id: old.id }, data: { status: "SUPERSEDED" } });
      return next;
    });
  });

  app.get("/runs", async () =>
    prisma.ingestRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 }),
  );
};

function readEntries(payload: unknown): Array<{
  key: string;
  name: string;
  ballotOrder?: number | null;
  isWriteIn?: boolean;
  isPlaceholder?: boolean;
}> {
  const entries = (payload as { entries?: unknown })?.entries;
  return Array.isArray(entries) ? entries : [];
}
