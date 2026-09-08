/**
 * Open Civic Data division identifiers.
 *
 * The canonical name for every place a US election can happen: 36,138 municipalities,
 * 17,235 school districts, 3,057 counties, plus council districts, wards and
 * precincts. Public domain, one CSV, no key.
 *
 *   https://github.com/opencivicdata/ocd-division-ids
 *
 * WHAT THIS IS FOR, and what it is not. It supplies the SPINE — a stable id and name
 * for every jurisdiction — so that a district resolved from an address, a race
 * resolved from a state file, and a coverage claim all refer to the same thing by the
 * same identifier. It contains no candidates and no elections, and importing it does
 * not make a single additional race covered.
 *
 * That distinction matters because 36,000 municipalities in a table looks like
 * coverage and is not. A `Jurisdiction` created from here has no races until an
 * adapter finds some, and the ballot endpoint reports it as not covered.
 *
 * The file is 22 MB and mostly precincts, which this product has no use for, so it is
 * filtered on the way in rather than stored whole.
 */
import { JurisdictionLevel } from "@civic/db";

export interface OcdDivision {
  id: string;
  name: string;
  level: JurisdictionLevel;
  /** The parent division id, derived from the id's own path. */
  parentId: string | null;
  state: string | null;
  censusGeoid: string | null;
}

/** The types worth holding. Precincts and wards are below any office we model. */
const LEVEL_BY_TYPE: Record<string, JurisdictionLevel> = {
  state: JurisdictionLevel.STATE,
  district: JurisdictionLevel.STATE, // DC
  territory: JurisdictionLevel.STATE,
  county: JurisdictionLevel.COUNTY,
  parish: JurisdictionLevel.COUNTY,
  borough: JurisdictionLevel.COUNTY,
  place: JurisdictionLevel.CITY,
  town: JurisdictionLevel.CITY,
  village: JurisdictionLevel.CITY,
  city: JurisdictionLevel.CITY,
  school_district: JurisdictionLevel.SCHOOL_DISTRICT,
  sch_dist: JurisdictionLevel.SCHOOL_DISTRICT,
};

/** The last segment's type, e.g. "place" from ".../state:tx/place:dallas". */
export function divisionType(id: string): string {
  const last = id.split("/").pop() ?? "";
  return last.split(":")[0] ?? "";
}

/** The parent is the id with its last segment removed. */
export function parentOf(id: string): string | null {
  const parts = id.split("/");
  return parts.length <= 2 ? null : parts.slice(0, -1).join("/");
}

export function stateOf(id: string): string | null {
  return id.match(/\/state:([a-z]{2})(\/|$)/)?.[1]?.toUpperCase() ?? null;
}

/**
 * Keep only what this product can attach an office to.
 *
 * Also drops anything with a validThrough date in the past: OCD keeps retired
 * divisions, and a jurisdiction that no longer exists must not be offered as a place
 * someone can vote.
 */
export function selectDivisions(
  rows: Array<Record<string, string>>,
  opts: { states?: string[]; asOf?: Date } = {},
): OcdDivision[] {
  const asOf = opts.asOf ?? new Date();
  const wanted = opts.states?.map((s) => s.toUpperCase());
  const out: OcdDivision[] = [];

  for (const r of rows) {
    const id = (r.id ?? "").trim();
    if (!id) continue;
    const level = LEVEL_BY_TYPE[divisionType(id)];
    if (!level) continue;

    const state = stateOf(id);
    if (wanted && (!state || !wanted.includes(state))) continue;

    const validThrough = (r.validThrough ?? "").trim();
    if (validThrough && new Date(validThrough) < asOf) continue;

    out.push({
      id,
      name: (r.name ?? "").trim(),
      level,
      parentId: parentOf(id),
      state,
      censusGeoid: (r.census_geoid ?? "").trim() || null,
    });
  }
  return out;
}

export const OCD_URL =
  "https://raw.githubusercontent.com/opencivicdata/ocd-division-ids/master/identifiers/country-us.csv";
