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

