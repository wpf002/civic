/**
 * Maine and Colorado, both of which publish their candidate list as a spreadsheet
 * and nothing else.
 *
 * One file each, public and keyless, read with the minimal xlsx reader in
 * `packages/ingest/src/xlsx.ts` rather than a dependency.
 *
 * COVERAGE CEILINGS DIFFER, and that is a fact about the state rather than about the
 * data. Maine's list includes county row officers — sheriff, register of deeds,
 * district attorney, county commissioner. Colorado's stops at state and judicial
 * offices, because county filings stay with county clerks there. Recorded on the run
 * so a missing sheriff's race reads as a jurisdictional boundary and not a bug.
 *
 * Both are FILED, not certified.
 */
import { readXlsx } from "../xlsx.js";
import { nameKey, type Roster, type RosterEntry } from "../roster.js";

export const ME_URL =
  "https://www.maine.gov/sos/sites/maine.gov.sos/files/inline-files/2026%20General%20Candidate%20List%20-%20posting.xlsx";
export const CO_URL =
  "https://www.sos.state.co.us/pubs/elections/vote/files/2026/2026GeneralCandidateListOfficial.xlsx";

export interface StateCandidate {
  name: string;
  office: string;
  district: string | null;
  party: string | null;
  isWriteIn: boolean;
}

export interface StateRosterRun {
  basis: "FILED";
  state: "ME" | "CO";
  rosters: Roster[];
  candidateCount: number;
  /** The deepest level this state's file reaches. Not a gap; a boundary. */
  coverageCeiling: "state" | "county";
  unmapped: Array<{ office: string; count: number }>;
}

/** Maine: Office | Dist | County | Party | Date Filed | Last | First | Middle | Suffix | Town */
export function parseMaine(rows: string[][]): StateCandidate[] {
  const out: StateCandidate[] = [];
  for (const r of rows.slice(1)) {
    const office = (r[0] ?? "").trim();
    const last = (r[5] ?? "").trim();
    const first = (r[6] ?? "").trim();
    if (!office || !last) continue;
    const middle = (r[7] ?? "").trim();
    const suffix = (r[8] ?? "").trim();
    out.push({
      name: [first, middle, last, suffix].filter(Boolean).join(" ").replace(/\s+/g, " "),
      office,
      district: (r[1] ?? "").trim() || null,
      party: (r[3] ?? "").trim() || null,
      isWriteIn: false,
    });
  }
  return out;
}

/** Colorado: Candidate Name | Office | District | Party | Write In? */
export function parseColorado(rows: string[][]): StateCandidate[] {
  const out: StateCandidate[] = [];
  for (const r of rows.slice(1)) {
    const name = (r[0] ?? "").trim();
    const office = (r[1] ?? "").trim();
    if (!name || !office) continue;
    const district = (r[2] ?? "").trim();
    out.push({
      name,
      office,
      // Colorado writes "State" in the district column for a statewide office. That
      // is not a district and must not become one.
      district: district && district.toLowerCase() !== "state" ? district : null,
      party: (r[3] ?? "").trim() || null,
      isWriteIn: (r[4] ?? "").trim().toUpperCase() === "Y",
    });
  }
  return out;
}

/** Maine abbreviates offices: US = US Senate, CG = Congress. */
export function raceKeyMaine(office: string, district: string | null): string | null {
  const o = office.trim().toUpperCase();
  if (o === "US") return "us-senate-me";
  if (o === "CG" && district) return `us-house-me-${String(Number(district)).padStart(2, "0")}`;
  return null;
}

export function raceKeyColorado(office: string, district: string | null): string | null {
  const o = office.trim().toUpperCase();
  if (o === "US SENATE") return "us-senate-co";
  if (o.startsWith("US HOUSE") || o.startsWith("REPRESENTATIVE TO THE")) {
    const d = district ?? o.match(/(\d+)/)?.[1];
    if (d) return `us-house-co-${String(Number(d)).padStart(2, "0")}`;
  }
  return null;
}

export function toRosters(
  rows: StateCandidate[],
  state: "ME" | "CO",
  sourceUrl: string,
  observedAt: Date,
): StateRosterRun {
  const keyFor = state === "ME" ? raceKeyMaine : raceKeyColorado;
  const byRace = new Map<string, Map<string, RosterEntry>>();
  const unmapped = new Map<string, number>();

  for (const c of rows) {
    const raceKey = keyFor(c.office, c.district);
    if (!raceKey) {
      unmapped.set(c.office, (unmapped.get(c.office) ?? 0) + 1);
      continue;
    }
    const key = nameKey(c.name);
    const race = byRace.get(raceKey) ?? new Map<string, RosterEntry>();
    if (!race.has(key)) {
      race.set(key, { key, name: c.name, sourceName: c.name, isWriteIn: c.isWriteIn, sourceUrl });
    }
    byRace.set(raceKey, race);
  }

  const rosters = [...byRace.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([raceKey, race]) => ({
      raceKey,
      entries: [...race.values()].sort((a, b) => a.name.localeCompare(b.name)),
      sourceUrl,
      observedAt,
    }));

  return {
    basis: "FILED",
    state,
    rosters,
    candidateCount: rosters.reduce((n, r) => n + r.entries.length, 0),
    coverageCeiling: state === "ME" ? "county" : "state",
    unmapped: [...unmapped.entries()].map(([office, count]) => ({ office, count })).sort((a, b) => b.count - a.count),
  };
}

export async function fetchStateRoster(
  state: "ME" | "CO",
  observedAt: Date,
  opts: { fetchImpl?: typeof fetch; url?: string } = {},
): Promise<StateRosterRun> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = opts.url ?? (state === "ME" ? ME_URL : CO_URL);
  const res = await fetchImpl(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${state} returned ${res.status} for its candidate list`);

  const rows = readXlsx(Buffer.from(await res.arrayBuffer()));
  const parsed = state === "ME" ? parseMaine(rows) : parseColorado(rows);
  if (parsed.length === 0) {
    throw new Error(
      `${state} spreadsheet parsed to zero candidates. These states publish a filename with a ` +
        `revision date in it, so an empty parse usually means the layout changed or the file moved — ` +
        `either way it is a failed fetch, not an election with nobody running.`,
    );
  }
  return toRosters(parsed, state, url, observedAt);
}
