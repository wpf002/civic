/**
 * Resolving a source's seat name to a Race.
 *
 * The Dallas municipal sources name the same seat three ways. The certified ballot
 * prints "Place 7". The council district GIS layer returns DISTRICT = 7. The office
 * as seeded is "Dallas City Council Member" for District 7. All three are in real
 * use and none of them is derivable from the others by rule — Place 15 is the
 * at-large mayoralty and has no district at all.
 *
 * So the mapping is data, not arithmetic. `Office.seatLabel` holds the ballot term
 * exactly as the source prints it, entered by a person. This file only looks it up.
 *
 * Two things it deliberately will not do:
 *
 *   1. Fall back to "Place N means District N". A roster written into the wrong
 *      race is a silent, invisible error; a roster that quarantines is a visible
 *      one. The visible failure is the correct one.
 *   2. Create an Office or a Race. An adapter that can create the row it fails to
 *      find can never fail to find one.
 */
import { prisma } from "@civic/db";
import { placeSeatLabel } from "./adapters/dallas-city-secretary.js";

/**
 * `us-house-tx-07` → `District 7`, `us-senate-tx` → `Class II`.
 *
 * Same rule as the council places: the label is matched, never computed into a
 * district by arithmetic. An unmapped race key resolves to nothing and quarantines.
 */
export function federalSeatLabel(raceKey: string): string | null {
  const house = raceKey.match(/^us-house-[a-z]{2}-(\d{1,2})$/);
  if (house) return `District ${Number(house[1])}`;
  if (/^us-senate-[a-z]{2}$/.test(raceKey)) return "Class II";
  return null;
}

/**
 * Resolve a federal race key to a Race in a given election.
 *
 * Scoped to the office title as well as the seat label, because "District 7" is also
 * a city council district and a school board district. Without the title, a
 * congressional roster could land in a school board race.
 */
export async function resolveFederalSeat(
  electionSlug: string,
  raceKey: string,
): Promise<SeatResolution> {
  const seatLabel = federalSeatLabel(raceKey);
  if (!seatLabel) {
    return { raceId: null, reason: `"${raceKey}" is not a federal race key.` };
  }
  const title = raceKey.startsWith("us-senate")
    ? "United States Senator"
    : "United States Representative";

  const races = await prisma.race.findMany({
    where: { election: { slug: electionSlug }, office: { seatLabel, title } },
  });
  if (races.length === 0) {
    return {
      raceId: null,
      reason: `No "${title}" office in ${electionSlug} carries seatLabel "${seatLabel}".`,
    };
  }
  if (races.length > 1) {
    return { raceId: null, reason: `${races.length} offices match "${title}" / "${seatLabel}".` };
  }
  return { raceId: races[0]!.id, reason: "" };
}

/** `dallas-council-place-7` → `Place 7`. Returns null for any other shape. */
export function seatLabelForRaceKey(raceKey: string): string | null {
  const m = raceKey.match(/^dallas-council-place-(\d{1,2})$/);
  return m ? placeSeatLabel(m[1]!) : null;
}

export interface SeatResolution {
  raceId: string | null;
  /** Why nothing matched. Empty when a race was found. */
  reason: string;
}

/**
 * Resolve one ballot Place to a Race in a given election.
 *
 * Ambiguity is a failure, not a coin flip: two offices carrying the same seatLabel
 * in one election means the seat data is wrong, and guessing would hide that.
 */
export async function resolveCouncilSeat(
  electionSlug: string,
  raceKey: string,
): Promise<SeatResolution> {
  const seatLabel = seatLabelForRaceKey(raceKey);
  if (!seatLabel) {
    return { raceId: null, reason: `"${raceKey}" is not a Dallas council place key.` };
  }

  const races = await prisma.race.findMany({
    where: { election: { slug: electionSlug }, office: { seatLabel } },
    include: { office: { include: { district: true } } },
  });

  if (races.length === 0) {
    return {
      raceId: null,
      reason:
        `No office in ${electionSlug} carries seatLabel "${seatLabel}". The ballot term is ` +
        `entered by a person on the Office row; it is never inferred from a district number.`,
    };
  }
  if (races.length > 1) {
    return {
      raceId: null,
      reason:
        `${races.length} offices in ${electionSlug} carry seatLabel "${seatLabel}" ` +
        `(${races.map((r) => r.office.title).join(", ")}). A seat label must identify one race.`,
    };
  }
  return { raceId: races[0]!.id, reason: "" };
}
