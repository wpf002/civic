/**
 * Indiana's candidate list, from the Secretary of State's Election Division.
 *
 * The "abbreviated" list is a spreadsheet of every candidate for every office in every
 * county: name, party, office title and filing date, and no contact details. The file
 * name carries a timestamp that changes on each revision, so the link is read from the
 * index page.
 *
 * After the May primary it lists nominees, independents and write-ins; whether it has
 * become the general ballot is decided by the list itself (isGeneralBallot).
 */
import { nameKey, normalizeParty, type Roster, type RosterEntry } from "../roster.js";
import { keyForSpec, specFromPatterns, type OfficeSpec } from "../state-office-specs.js";
import { readXlsx } from "../xlsx.js";

export const IN_INDEX = "https://www.in.gov/sos/elections/candidate-information/";
const UA = { "user-agent": "Mozilla/5.0 (civic voter guide)" };

export interface InCandidate {
  name: string;
  party: string | null;
  office: string;
  isWriteIn: boolean;
}

const ORDINAL: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
};

/** Rows of [name, party, office title, filed, ...]; section header rows are skipped. */
export function parseList(rows: string[][]): InCandidate[] {
  const out: InCandidate[] = [];
  for (const r of rows) {
    const name = (r[0] ?? "").trim();
    const partyRaw = (r[1] ?? "").trim();
    const office = (r[2] ?? "").replace(/\s+/g, " ").trim();
    if (!name || !office || name === "OFFICE TITLE" || partyRaw === "PARTY") continue;
    // Write-ins are "Write-In (Independent)": the party is inside the parentheses.
    const writeIn = partyRaw.match(/^Write-In(?: \((.*)\))?$/i);
    out.push({
      name: name.replace(/\s+/g, " "),
      party: writeIn ? null : partyRaw || null,
      office,
      isWriteIn: !!writeIn,
    });
  }
  return out;
}

export function raceKeyForOffice(office: string): string | null {
  const house = office.match(/^United States Representative, (\w+) District$/i);
  if (house) {
    const n = ORDINAL[house[1]!.toLowerCase()];
    return n ? `us-house-in-${String(n).padStart(2, "0")}` : null;
  }
  if (/^United States Senator$/i.test(office)) return "us-senate-in";
  if (/^Governor$/i.test(office)) return "governor-in";
  const spec = inOfficeSpec(office);
  return spec ? keyForSpec("IN", spec) : null;
}

/** Statewide officers and both chambers. Courts, prosecutors and county offices stay unmapped. */
export function inOfficeSpec(office: string): OfficeSpec | null {
  return specFromPatterns(office, {
    upper: /^State Senator, District (\d+)$/i,
    lower: /^State Representative, District (\d+)$/i,
    statewide: [/^(Secretary of State|State Comptroller \(Auditor of State\)|Treasurer of State)$/i],
  });
}

export interface InRosterRun {
  rosters: Roster[];
  candidateCount: number;
  offices: Map<string, OfficeSpec>;
  unmappedCount: number;
}

export function toRosters(rows: InCandidate[], sourceUrl: string, observedAt: Date): InRosterRun {
  const byRace = new Map<string, Map<string, RosterEntry>>();
  const offices = new Map<string, OfficeSpec>();
  let unmappedCount = 0;
  for (const c of rows) {
    const raceKey = raceKeyForOffice(c.office);
    if (!raceKey) {
      unmappedCount++;
      continue;
    }
    const spec = inOfficeSpec(c.office);
    if (spec) offices.set(raceKey, spec);
    const key = nameKey(c.name);
    const race = byRace.get(raceKey) ?? new Map<string, RosterEntry>();
    if (!race.has(key)) {
      race.set(key, {
        key,
        name: c.name,
        displayName: c.name,
        sourceName: c.name,
        isWriteIn: c.isWriteIn,
        party: normalizeParty(c.party),
        sourceUrl,
      });
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
  return { rosters, candidateCount: rosters.reduce((n, r) => n + r.entries.length, 0), offices, unmappedCount };
}

export async function currentListUrl(fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(IN_INDEX, { headers: UA });
  if (!res.ok) throw new Error(`Indiana candidate page returned ${res.status}`);
  const href = (await res.text()).match(/href="([^"]*Candidate_List_Abbreviated_[^"]*\.xlsx)"/i)?.[1];
  if (!href) throw new Error("Indiana candidate page no longer links an abbreviated candidate list");
  return new URL(href, IN_INDEX).toString();
}

export async function fetchInRoster(observedAt: Date, fetchImpl: typeof fetch = fetch): Promise<InRosterRun> {
  const url = await currentListUrl(fetchImpl);
  const res = await fetchImpl(url, { headers: UA });
  if (!res.ok) throw new Error(`Indiana candidate list returned ${res.status}`);
  const rows = parseList(readXlsx(Buffer.from(await res.arrayBuffer())));
  if (rows.length < 500) throw new Error(`Indiana list parsed to ${rows.length} candidates; the layout changed`);
  return toRosters(rows, url, observedAt);
}
