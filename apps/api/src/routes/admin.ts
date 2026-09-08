import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "@civic/db";
import { reviewerFromToken, type AuthedReviewer } from "../auth.js";

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
  /**
   * Two ways in, and they are not equal.
   *
   * A reviewer session identifies a person: the audit trail on a published position
   * records who they actually are, revoking their access takes effect on the next
   * request, and two reviewers are distinguishable.
   *
   * The shared ADMIN_TOKEN remains for scripted runs only, and every one of them has
   * to name a reviewer in a header. It is strictly weaker — the name is a text field
   * nobody verified — and it is refused entirely once ALLOW_SHARED_ADMIN_TOKEN is
   * turned off, which is what a real deployment does.
   */
  app.addHook("onRequest", async (req, reply) => {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");

    const session = await reviewerFromToken(bearer || undefined);
    if (session) {
      (req as { authedReviewer?: AuthedReviewer }).authedReviewer = session;
      return;
    }

    const shared = process.env.ADMIN_TOKEN;
    const sharedAllowed = process.env.ALLOW_SHARED_ADMIN_TOKEN !== "false";
    if (!sharedAllowed) return reply.code(401).send({ error: "sign in as a reviewer" });
    if (!shared || shared === "change-me") {
      return reply.code(503).send({ error: "no reviewer session and ADMIN_TOKEN is not configured" });
    }
    if (bearer !== shared) return reply.code(401).send();
  });

  /**
   * Who is accountable for this action.
   *
   * A verified session wins over the x-reviewer header every time. Letting a header
   * override a real identity would make the audit trail forgeable by the one caller
   * we can actually identify.
   */
  const reviewer = (req: { headers: Record<string, unknown>; authedReviewer?: AuthedReviewer }) =>
    req.authedReviewer?.displayName ??
    ((req.headers["x-reviewer"] as string | undefined)?.trim() || null);

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

  /**
   * Publish many positions in one reviewed decision.
   *
   * Exists because absences are numerous by nature — a candidate who addresses three
   * issues is silent on seventeen — and publishing them one HTTP call at a time is
   * hours of work for one decision a person already made.
   *
   * Every per-row rule still applies. A stance with no evidence is refused here
   * exactly as it is refused singly, and the refusals come back itemised rather than
   * failing the batch: a caller must be able to see which rows did not go live.
   */
  app.post("/positions/publish-batch", async (req, reply) => {
    const body = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(req.body);
    const who = reviewer(req);
    if (!who) return reply.code(400).send({ error: "x-reviewer header is required" });

    const rows = await prisma.position.findMany({
      where: { id: { in: body.ids } },
      include: { evidence: { select: { id: true } } },
    });

    const publishable: string[] = [];
    const refused: Array<{ id: string; why: string }> = [];

    for (const p of rows) {
      if (p.status === "PUBLISHED") {
        refused.push({ id: p.id, why: "already published" });
        continue;
      }
      const isAbsence = p.stance === "NO_STATED_POSITION" || p.stance === "DECLINED_TO_STATE";
      if (!isAbsence && p.evidence.length === 0) {
        refused.push({ id: p.id, why: "a stance with no evidence cannot be published" });
        continue;
      }
      publishable.push(p.id);
    }

    const now = new Date();
    const result = await prisma.position.updateMany({
      where: { id: { in: publishable } },
      data: { status: "PUBLISHED", reviewedBy: who, reviewedAt: now, publishedAt: now },
    });

    return { ok: true, published: result.count, refused, requested: body.ids.length };
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

  /**
   * Merge two candidate records that are the same person.
   *
   * Different authorities spell people differently — the FEC says "Sylvia R Garcia"
   * and the certified ballot says "Sylvia Garcia" — so one person ends up holding two
   * rows, and the row carrying their website is often not the row on the ballot.
   *
   * This is a removal: one record stops existing. So it is a reviewed action with a
   * named reviewer, it refuses to act across different races, and it moves every
   * reference before deleting anything. The absorbed id is written into the surviving
   * record's externalIds so the merge stays traceable afterwards.
   */
  app.post("/candidates/merge", async (req, reply) => {
    const body = z
      .object({
        /** The record to keep. Should be the one on the certified ballot. */
        keepId: z.string(),
        /** The record to absorb. */
        mergeId: z.string(),
        note: z.string().max(500).optional(),
      })
      .parse(req.body);
    const who = reviewer(req);
    if (!who) return reply.code(400).send({ error: "x-reviewer header is required" });
    if (body.keepId === body.mergeId) {
      return reply.code(400).send({ error: "keepId and mergeId are the same record" });
    }

    const [keep, merge] = await Promise.all([
      prisma.candidate.findUnique({ where: { id: body.keepId }, include: { candidacies: true } }),
      prisma.candidate.findUnique({ where: { id: body.mergeId }, include: { candidacies: true } }),
    ]);
    if (!keep || !merge) return reply.code(404).send({ error: "not found" });

    // Both records must be in the same race. Same-race is the entire basis on which
    // two similar names were proposed as one person; without it this is just a guess
    // that two people in Texas share a name.
    const keepRaces = new Set(keep.candidacies.map((c) => c.raceId));
    const shared = merge.candidacies.filter((c) => keepRaces.has(c.raceId));
    if (shared.length === 0) {
      return reply.code(422).send({
        error: "these records share no race",
        why:
          "Two similar names are only proposed as one person because they appear in the " +
          "same contest. Merging across races would be merging on a name alone.",
      });
    }

    const merged = await prisma.$transaction(async (tx) => {
      // Everything the absorbed record owns moves first. Nothing is deleted until the
      // row has no references left.
      await tx.position.updateMany({ where: { candidateId: merge.id }, data: { candidateId: keep.id } });
      await tx.source.updateMany({ where: { candidateId: merge.id }, data: { candidateId: keep.id } });
      await tx.incumbency.updateMany({ where: { candidateId: merge.id }, data: { candidateId: keep.id } });
      await tx.voteRecord.updateMany({ where: { candidateId: merge.id }, data: { candidateId: keep.id } });

      let movedCandidacies = 0;
      for (const c of merge.candidacies) {
        const existing = keep.candidacies.find((k) => k.raceId === c.raceId);
        if (!existing) {
          await tx.candidacy.update({ where: { id: c.id }, data: { candidateId: keep.id } });
          movedCandidacies++;
          continue;
        }
        // Both records are in this race. Keep the surviving candidacy but take
        // anything the absorbed one knew and the survivor did not — certification
        // especially, since that is what decides whether the name is on a ballot.
        await tx.candidacy.update({
          where: { id: existing.id },
          data: {
            isCertified: existing.isCertified || c.isCertified,
            isIncumbent: existing.isIncumbent || c.isIncumbent,
            isWriteIn: existing.isWriteIn || c.isWriteIn,
            ...(existing.ballotOrder == null && c.ballotOrder != null ? { ballotOrder: c.ballotOrder } : {}),
            ...(existing.certifiedAt == null && c.certifiedAt ? { certifiedAt: c.certifiedAt } : {}),
            ...(existing.filedAt == null && c.filedAt ? { filedAt: c.filedAt } : {}),
            ...(existing.status === "DECLARED" && c.status !== "DECLARED" ? { status: c.status } : {}),
          },
        });
        await tx.candidacy.delete({ where: { id: c.id } });
      }

      const keepIds = (keep.externalIds as Record<string, Prisma.InputJsonValue> | null) ?? {};
      const mergeIds = (merge.externalIds as Record<string, Prisma.InputJsonValue> | null) ?? {};
      const priorMerges = Array.isArray(keepIds.mergedFrom) ? (keepIds.mergedFrom as Prisma.InputJsonValue[]) : [];
      const updated = await tx.candidate.update({
        where: { id: keep.id },
        data: {
          // The absorbed record's ids are the point of the merge: that is where the
          // FEC id, and usually the website, lives.
          externalIds: {
            ...mergeIds,
            ...keepIds,
            mergedFrom: [
              ...priorMerges,
              { id: merge.id, fullName: merge.fullName, by: who, at: new Date().toISOString() },
            ],
          },
          ...(keep.websiteUrl ? {} : merge.websiteUrl ? { websiteUrl: merge.websiteUrl } : {}),
          ...(keep.photoUrl ? {} : merge.photoUrl ? { photoUrl: merge.photoUrl } : {}),
          ...(keep.bio ? {} : merge.bio ? { bio: merge.bio } : {}),
        },
      });

      await tx.candidate.delete({ where: { id: merge.id } });

      await tx.reviewTask.updateMany({
        where: { kind: "CANDIDATE_PROFILE", targetId: { in: [keep.id, merge.id] }, resolvedAt: null },
        data: {
          resolvedAt: new Date(),
          resolution: `Merged "${merge.fullName}" into "${keep.fullName}" by ${who}${body.note ? ` — ${body.note}` : ""}`,
        },
      });

      return { candidate: updated, movedCandidacies };
    });

    return { ok: true, keptId: keep.id, absorbed: merge.fullName, ...merged };
  });

  /**
   * A review queue grouped by race, plus a sample.
   *
   * Reviewing 8,000 positions one at a time is not a workflow, and a reviewer who
   * clicks publish 8,000 times is not reviewing. Two things make it tractable:
   *
   * Grouping by race, because that is the unit a person can actually hold in their
   * head — every candidate for one seat, side by side, is where a wrong stance
   * stands out against its neighbours.
   *
   * Sampling, because the decision worth making is about the BATCH. A reviewer reads
   * a random sample, and the error rate in that sample is what says whether the rest
   * publishes. `sample` is drawn deterministically from the position id so the same
   * request returns the same rows — a sample that reshuffles on refresh lets a
   * reviewer keep drawing until they like the answer.
   */
  app.get("/review/races", async (req) => {
    const q = z
      .object({
        election: z.string().optional(),
        sample: z.coerce.number().min(1).max(50).default(5),
      })
      .parse(req.query ?? {});

    const races = await prisma.race.findMany({
      where: q.election ? { election: { slug: q.election } } : {},
      include: {
        office: { include: { district: true } },
        election: { select: { slug: true, name: true } },
        candidacies: {
          where: { isCertified: true },
          include: {
            candidate: {
              select: {
                id: true,
                slug: true,
                fullName: true,
                websiteUrl: true,
                _count: { select: { sources: true } },
              },
            },
          },
        },
      },
    });

    const out = [];
    for (const race of races) {
      const ids = race.candidacies.map((c) => c.candidate.id);
      if (ids.length === 0) continue;

      const [pending, published, noSource] = await Promise.all([
        prisma.position.count({
          where: { candidateId: { in: ids }, status: "IN_REVIEW", NOT: { propositionId: null } },
        }),
        prisma.position.count({ where: { candidateId: { in: ids }, status: "PUBLISHED" } }),
        Promise.resolve(race.candidacies.filter((c) => c.candidate._count.sources === 0).length),
      ]);
      if (pending === 0 && published === 0) continue;

      const waiting = await prisma.position.findMany({
        where: { candidateId: { in: ids }, status: "IN_REVIEW", NOT: { propositionId: null } },
        include: {
          candidate: { select: { fullName: true } },
          proposition: { select: { text: true } },
          issue: { select: { slug: true } },
          evidence: { include: { source: { select: { url: true, capturedAt: true } } } },
        },
        orderBy: { id: "asc" },
      });

      // Deterministic: same request, same sample. A reshuffling sample lets a
      // reviewer redraw until the batch looks good.
      const step = Math.max(1, Math.floor(waiting.length / q.sample));
      const sample = waiting.filter((_, i) => i % step === 0).slice(0, q.sample);

      out.push({
        raceId: race.id,
        election: race.election.slug,
        office: race.office.title,
        seat: race.office.seatLabel ?? race.office.district?.name ?? null,
        certifiedCandidates: race.candidacies.length,
        candidatesWithNoSource: noSource,
        pending,
        published,
        sample: sample.map((p) => ({
          id: p.id,
          candidate: p.candidate?.fullName ?? null,
          issue: p.issue.slug,
          question: p.proposition?.text ?? null,
          stance: p.stance,
          summary: p.summary,
          quote: p.evidence[0]?.quote ?? null,
          sourceUrl: p.evidence[0]?.source.url ?? null,
        })),
        /** Every id in the batch, so a reviewer who accepts the sample can publish it. */
        batchIds: waiting.map((p) => p.id),
      });
    }

    return {
      races: out.sort((a, b) => b.pending - a.pending),
      totals: {
        races: out.length,
        pending: out.reduce((n, r) => n + r.pending, 0),
        published: out.reduce((n, r) => n + r.published, 0),
      },
    };
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
