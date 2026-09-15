/**
 * One real street address inside every 2026 House district, to ask for that
 * district's ballot.
 *
 * Ballot lookups are by address, and a district's contests are the same for every
 * address in it, so one address per district reads the whole federal ballot. The
 * addresses are public library buildings, from the Institute of Museum and Library
 * Services' Public Libraries Survey: about 17,000 outlets with a street address,
 * coordinates and a 2020 census block, in every state and DC. Nobody's home.
 *
 * Which district a library is in comes from the plan in force (plan-lookup.ts), not
 * from the survey's own district code, which is the 119th Congress's map.
 */
import { houseSeatLabel, stateByCode } from "@civic/core";
import { readZip } from "../xlsx.js";
import { parseCsv } from "./nc-sbe.js";

export const IMLS_OUTLETS_ZIP = "https://www.imls.gov/sites/default/files/2026-06/pls_fy2024_csv.zip";

export interface Library {
  state: string;
  address: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  block: string;
  /** The survey's district, on the 119th Congress map. "00" at large, "98" DC. */
  cd119: string;
}

/**
 * Allow-list: the building's location and nothing else. Outlets without a fixed
 * street address (bookmobiles, books-by-mail) are dropped, since a ballot lookup
 * needs a place.
 */
export function parseOutlets(csv: string): Library[] {
  const out: Library[] = [];
  for (const r of parseCsv(csv)) {
    if (r.C_OUT_TY === "BS" || r.C_OUT_TY === "BM") continue;
    const state = (r.STABR ?? "").trim();
    const address = (r.ADDRESS ?? "").trim();
    const lat = Number(r.LATITUDE);
    const lon = Number(r.LONGITUD);
    const block = (r.CENBLOCK ?? "").trim();
    if (!stateByCode(state) || !address || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (/^P\.?\s*O\.?\s*BOX/i.test(address)) continue;
    out.push({
      state,
      address,
      city: (r.CITY ?? "").trim(),
      zip: (r.ZIP ?? "").trim(),
      lat,
      lon,
      block: /^\d{15}$/.test(block) ? block : "",
      cd119: (r.CDCODE ?? "").trim().slice(-2),
    });
  }
  return out;
}

export async function fetchLibraries(fetchImpl: typeof fetch = fetch): Promise<Library[]> {
  const res = await fetchImpl(IMLS_OUTLETS_ZIP);
  if (!res.ok) throw new Error(`IMLS returned ${res.status}`);
  const member = readZip(Buffer.from(await res.arrayBuffer())).find((e) => /outlet.*\.csv$/i.test(e.name));
  if (!member) throw new Error("IMLS zip has no outlet file");
  const libs = parseOutlets(member.data.toString("latin1"));
  if (libs.length < 10_000) throw new Error(`IMLS outlet file parsed to ${libs.length} libraries; expected ~17,000`);
  return libs;
}

/** The Census-layer district name for a survey code, for states whose map did not change. */
export function censusNameFor(state: string, cd119: string): string | undefined {
  if (!/^\d{2}$/.test(cd119)) return undefined;
  if (cd119 === "00" || cd119 === "98") return "Congressional District (at Large)";
  return `Congressional District ${Number(cd119)}`;
}

export const oneLine = (l: Library) => `${l.address}, ${l.city}, ${l.state} ${l.zip}`;

/** Deterministic pick: the same library every run, so a changed ballot is a real change. */
export function pickPerDistrict(
  placed: Array<{ library: Library; seat: string }>,
  perDistrict = 1,
): Map<string, Library[]> {
  const by = new Map<string, Library[]>();
  const sorted = [...placed].sort((a, b) => oneLine(a.library).localeCompare(oneLine(b.library)));
  for (const { library, seat } of sorted) {
    const key = `${library.state}|${seat}`;
    const list = by.get(key) ?? [];
    if (list.length < perDistrict) list.push(library);
    by.set(key, list);
  }
  return by;
}

/** Every House seat in a state, so a district with no library shows up as missing. */
export const allSeats = (state: string): string[] => {
  const st = stateByCode(state);
  if (!st) return [];
  return Array.from({ length: st.houseSeats }, (_, i) => houseSeatLabel(st.code, i + 1));
};
