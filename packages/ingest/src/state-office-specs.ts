/**
 * Keys and seat labels for state offices. Pure, so adapters can use it without a
 * database; creating and resolving the races is state-offices.ts.
 */
import { legislativeSeatLabel, officeSlug, officeTitleCase, type Chamber } from "@civic/core";

export interface OfficeSpec {
  title: string;
  seatLabel: string;
  /** Set for legislative seats, which belong to a district. */
  chamber?: Chamber;
}

export const legislativeKey = (state: string, chamber: Chamber, id: string) =>
  `state-${chamber === "upper" ? "senate" : "house"}-${state.toLowerCase()}-${id.toLowerCase()}`;

export const statewideKey = (state: string, title: string) => `statewide-${state.toLowerCase()}-${officeSlug(title)}`;

export function legislativeSpec(chamber: Chamber, id: string): OfficeSpec {
  return {
    title: chamber === "upper" ? "State Senator" : "State Representative",
    seatLabel: legislativeSeatLabel(chamber, id),
    chamber,
  };
}

export function statewideSpec(rawTitle: string): OfficeSpec {
  const title = officeTitleCase(rawTitle);
  return { title, seatLabel: title };
}


export interface OfficePatterns {
  /** Capture group 1 is the district id as the state writes it. */
  upper?: RegExp;
  lower?: RegExp;
  statewide?: RegExp[];
}

/** The office a ballot line names, by a state's own patterns, or null. */
export function specFromPatterns(name: string, p: OfficePatterns): OfficeSpec | null {
  const n = name.replace(/\s+/g, " ").trim();
  const id = (m: RegExpMatchArray | null) => (m?.[1] ? m[1].replace(/^0+(?=\d)/, "") : null);
  const up = p.upper ? id(n.match(p.upper)) : null;
  if (up) return legislativeSpec("upper", up);
  const low = p.lower ? id(n.match(p.lower)) : null;
  if (low) return legislativeSpec("lower", low);
  if (p.statewide?.some((re) => re.test(n))) return statewideSpec(n);
  return null;
}

export const keyForSpec = (state: string, spec: OfficeSpec): string =>
  spec.chamber ? legislativeKey(state, spec.chamber, spec.seatLabel.split("District ")[1]!) : statewideKey(state, spec.title);
