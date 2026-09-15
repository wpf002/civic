import { pointInAny, type Polygon } from "@civic/core";
import { prisma } from "@civic/db";

export interface HouseDistrictAnswer {
  /** Census-style name ("Congressional District 33"), or null when it cannot be known. */
  name: string | null;
  /** Which plan answered, for provenance. Null when the Census layer answered. */
  plan: string | null;
  /** Why there is no answer, in words a voter can read. */
  unknownBecause?: string;
}

/**
 * The House district for an address on election day.
 *
 * A state with a plan registered for the election is answered only from that plan.
 * If the plan cannot place the address, the answer is "unknown", never the Census
 * layer: in those states the Census layer is the old map, and the old map is exactly
 * the wrong answer this exists to prevent.
 */
export async function houseDistrict(
  stateCode: string,
  electionDate: Date,
  address: { block?: string; point: { lat: number; lon: number }; censusName?: string },
): Promise<HouseDistrictAnswer> {
  const plan = await prisma.districtPlan.findFirst({
    where: { state: stateCode, chamber: "CONGRESS", firstElection: { lte: electionDate } },
    orderBy: { firstElection: "desc" },
    select: { id: true, name: true, lookup: true },
  });
  if (!plan) return { name: address.censusName ?? null, plan: null };

  const named = (d: string) => `Congressional District ${d === "0" ? "(at Large)" : d}`;

  if (plan.lookup === "BLOCKS" && address.block) {
    const hit = await prisma.blockAssignment.findUnique({
      where: { planId_block: { planId: plan.id, block: address.block } },
      select: { district: true },
    });
    if (hit) return { name: named(hit.district), plan: plan.name };
  }

  if (plan.lookup === "SHAPES") {
    const { lat, lon } = address.point;
    const candidates = await prisma.districtShape.findMany({
      where: { planId: plan.id, minLon: { lte: lon }, maxLon: { gte: lon }, minLat: { lte: lat }, maxLat: { gte: lat } },
      select: { district: true, polygons: true },
    });
    const hits = candidates.filter((c) => pointInAny(lon, lat, c.polygons as unknown as Polygon[]));
    // Exactly one. Zero is a gap in the boundary file; two is an overlap. Neither is
    // an answer.
    if (hits.length === 1) return { name: named(hits[0]!.district), plan: plan.name };
  }

  return {
    name: null,
    plan: plan.name,
    unknownBecause:
      plan.lookup === "UNRESOLVABLE"
        ? `This state's 2026 House districts (${plan.name}) are not published in a form we can look up yet, so we can't show your House race.`
        : `We couldn't place this address in the 2026 House map (${plan.name}), so we can't show your House race.`,
  };
}
