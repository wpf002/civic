/**
 * The ingest runner: fetch → snapshot → diff → decide.
 *
 * Writes RosterSnapshot on EVERY run, including unchanged ones, because a snapshot
 * history is the only thing that makes a shrink detectable after the fact. Writes
 * RosterDiff for every comparison. Writes Candidacy rows only when the diff is
 * AUTO_APPLIED, which by construction means nothing was removed.
 *
 * The invariant, enforced here and asserted in a test: a diff with a non-empty
 * `removed` set never reaches the write path. It becomes a ReviewTask and the
 * previously published roster stays live and unchanged.
 */
import { prisma, type Prisma } from "@civic/db";
import { diffRoster, type Roster } from "./roster.js";

export interface RunOptions {
  adapter: string;
  electionSlug: string;
  /** Print what would happen and write nothing. */
  dryRun?: boolean;
}

export interface RunOutcome {
  ingestRunId: string | null;
  races: Array<{
    raceKey: string;
    verdict: "AUTO_APPLIED" | "QUARANTINED";
    added: string[];
    removed: string[];
    reasons: string[];
    applied: boolean;
  }>;
}

/** Snapshot payload as stored. Kept flat so a future reader needs no code to read it. */
function toPayload(r: Roster): Prisma.InputJsonValue {
  return {
    raceKey: r.raceKey,
    sourceUrl: r.sourceUrl,
    observedAt: r.observedAt.toISOString(),
    entries: r.entries.map((e) => ({
      key: e.key,
      name: e.name,
      ballotOrder: e.ballotOrder ?? null,
      isWriteIn: !!e.isWriteIn,
      isPlaceholder: !!e.isPlaceholder,
      sourceUrl: e.sourceUrl ?? null,
    })),
  };
}

/** Read a stored snapshot payload back. Tolerates a payload written by an older shape. */
function readEntries(payload: unknown): Roster["entries"] {
  const entries = (payload as { entries?: unknown })?.entries;
  return Array.isArray(entries) ? (entries as Roster["entries"]) : [];
}

async function sha256(s: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Persist one adapter run.
 *
 * `resolveRaceId` maps an adapter's race key ("disd-trustee-2") to a Race row. It is
 * injected rather than inferred: an adapter must never create a Race, because a race
 * that exists only because a scraper saw it is a race nobody reviewed.
 */
export async function persistRun(
  opts: RunOptions,
  rosters: Roster[],
  resolveRaceId: (raceKey: string) => Promise<string | null>,
): Promise<RunOutcome> {
  const outcome: RunOutcome = { ingestRunId: null, races: [] };

  const election = await prisma.election.findUnique({ where: { slug: opts.electionSlug } });
  if (!election) throw new Error(`unknown election ${opts.electionSlug}`);

  const run = opts.dryRun
    ? null
    : await prisma.ingestRun.create({
        data: { adapter: opts.adapter, electionId: election.id, fetchCount: rosters.length },
      });
  outcome.ingestRunId = run?.id ?? null;

  let changed = 0;
  let quarantined = 0;

  for (const roster of rosters) {
    const raceId = await resolveRaceId(roster.raceKey);
    if (!raceId) {
      // A roster for a race we do not have is not an error, but it is never silent.
      outcome.races.push({
        raceKey: roster.raceKey,
        verdict: "QUARANTINED",
        added: [],
        removed: [],
        reasons: [`No Race row matches "${roster.raceKey}". An adapter never creates a race.`],
        applied: false,
      });
      quarantined++;
      continue;
    }

    const race = await prisma.race.findUniqueOrThrow({ where: { id: raceId } });

    // Compare against the last ACCEPTED snapshot, not merely the last one — otherwise
    // a quarantined bad parse silently becomes the new baseline.
    const prevRow = await prisma.rosterSnapshot.findFirst({
      where: { raceId, accepted: true },
      orderBy: { observedAt: "desc" },
    });
    const previous: Roster | null = prevRow
      ? {
          raceKey: roster.raceKey,
          sourceUrl: prevRow.sourceUrl,
          observedAt: prevRow.observedAt,
          entries: readEntries(prevRow.payload),
        }
      : null;

    const diff = diffRoster(previous, roster, {
      ...(race.expectedCandidateCount != null
        ? { expectedCount: race.expectedCandidateCount }
        : {}),
    });
    const applied = diff.verdict === "AUTO_APPLIED";

    outcome.races.push({
      raceKey: roster.raceKey,
      verdict: diff.verdict,
      added: diff.added.map((a) => a.name),
      removed: diff.removed.map((r) => r.name),
      reasons: diff.reasons,
      applied: applied && !opts.dryRun,
    });

    if (opts.dryRun) continue;

    const snapshot = await prisma.rosterSnapshot.create({
      data: {
        raceId,
        ingestRunId: run!.id,
        adapter: opts.adapter,
        candidateCount: roster.entries.length,
        payload: toPayload(roster),
        sourceUrl: roster.sourceUrl,
        sourceHash: await sha256(JSON.stringify(toPayload(roster))),
        accepted: applied,
      },
    });

    await prisma.rosterDiff.create({
      data: {
        raceId,
        ...(prevRow ? { fromSnapshotId: prevRow.id } : {}),
        toSnapshotId: snapshot.id,
        added: diff.added.map((a) => a.name),
        removed: diff.removed.map((r) => r.name),
        changed: diff.changed as unknown as Prisma.InputJsonValue,
        verdict: diff.verdict,
      },
    });

    if (!applied) {
      quarantined++;
      await prisma.reviewTask.create({
        data: {
          kind: "SOURCE_FLAG",
          targetId: snapshot.id,
          reason: `Roster change quarantined for ${roster.raceKey}: ${diff.reasons.join(" ")}`,
        },
      });
      continue;
    }

    changed += diff.added.length;
    await applyAdditive(raceId, roster, opts.adapter);
  }

  if (run) {
    await prisma.ingestRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        changedCount: changed,
        status: quarantined > 0 ? "QUARANTINED" : "OK",
      },
    });
  }

  return outcome;
}

/**
 * Apply an all-additive roster.
 *
 * Only ever adds or refreshes. There is deliberately no delete path in this file —
 * a removal cannot reach here, and if a future refactor lets one through, the
 * absence of delete code means the worst case is a stale row rather than a
 * disappeared candidate.
 */
async function applyAdditive(raceId: string, roster: Roster, adapter: string): Promise<void> {
  const now = new Date();
  for (const entry of roster.entries) {
    if (entry.isPlaceholder) continue; // an unnamed line is never a Candidate row

    const slug = entry.key.replace(/\s+/g, "-");
    const candidate = await prisma.candidate.upsert({
      where: { slug },
      update: { fullName: entry.name },
      create: { slug, fullName: entry.name },
    });

    const existing = await prisma.candidacy.findUnique({
      where: { raceId_candidateId: { raceId, candidateId: candidate.id } },
    });

    if (existing) {
      await prisma.candidacy.update({
        where: { id: existing.id },
        data: {
          lastObservedAt: now,
          observedSourceUrl: roster.sourceUrl,
          ...(entry.ballotOrder != null ? { ballotOrder: entry.ballotOrder } : {}),
        },
      });
      continue;
    }

    await prisma.candidacy.create({
      data: {
        raceId,
        candidateId: candidate.id,
        status: "DECLARED",
        isWriteIn: !!entry.isWriteIn,
        firstObservedAt: now,
        lastObservedAt: now,
        observedSourceUrl: roster.sourceUrl,
        ...(entry.ballotOrder != null ? { ballotOrder: entry.ballotOrder } : {}),
      },
    });
  }

  await prisma.race.update({
    where: { id: raceId },
    data: { rosterStatus: "FILING_OPEN", cancelledReason: null },
  });
  void adapter;
}
