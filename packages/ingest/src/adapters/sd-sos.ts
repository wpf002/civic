/**
 * South Dakota candidates, from the Secretary of State's VIP candidate list.
 *
 * A server-rendered HTML table, public and keyless. The sixth state adapter.
 *
 * It carries one thing the other five do not: withdrawal status, and it carries it
 * INSIDE the name — "Julian Beaudion (Withdrawn)". Read naively that becomes a
 * candidate whose surname is "(Withdrawn)", listed as running. Both halves matter
 * here: the name has to be cleaned, and the withdrawal has to survive as a fact,
 * because showing a withdrawn candidate as active is exactly the error the roster
 * guard exists to prevent — arriving through the front door this time.
 *
 * PRIVACY: the table includes each candidate's home mailing address, city, state and
 * zip. Dropped at the parse boundary by allow-list, same rule as Texas and NC.
 *
 * Basis is FILED.
 */
import { nameKey, type Roster, type RosterEntry } from "../roster.js";

export const SD_URL = "https://vip.sdsos.gov/candidatelist.aspx";
export const NOVEMBER_2026_EID = "774";
export const sdUrl = (eid: string) => `${SD_URL}?eid=${eid}`;

export interface SdCandidate {
  office: string;
  name: string;
  party: string | null;
  /** True when the source marked them withdrawn, however it phrased it. */
  isWithdrawn: boolean;
  filedAt: string | null;
}

const STRIP_TAGS = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/**
 * Split a status out of the name.
 *
 * The source writes it as a parenthetical, sometimes unclosed — the real 2026 row is
 * "Julian Beaudion (Withdrawn" with no closing bracket, which a stricter pattern
 * would miss entirely and leave in the name.
 */
export function splitStatus(raw: string): { name: string; isWithdrawn: boolean } {
  const m = raw.match(/\(\s*(withdrawn|disqualified|deceased|removed)[^)]*\)?\s*$/i);
  if (!m) return { name: raw.trim(), isWithdrawn: false };
  return { name: raw.slice(0, m.index).trim(), isWithdrawn: true };
}

/** Allow-list: office, name, party, status, filing date. Nothing else is kept. */
export function parseSdTable(html: string): SdCandidate[] {
  const out: SdCandidate[] = [];
  for (const row of html.matchAll(/<tr[^>]*class="rg(?:Row|AltRow)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => STRIP_TAGS(c[1]!));
    const office = cells[0] ?? "";
    const rawName = cells[1] ?? "";
    if (!office || !rawName) continue;

    const { name, isWithdrawn } = splitStatus(rawName);
    if (!name) continue;

    out.push({
      office,
      name,
      party: (cells[2] ?? "").trim() || null,
      isWithdrawn,
      filedAt: (cells[3] ?? "").trim() || null,
    });
  }
  return out;
}

export function raceKeyForOffice(office: string): string | null {
  const o = office.toUpperCase().replace(/\s+/g, " ").trim();
  if (/^UNITED STATES SENATOR$/.test(o)) return "us-senate-sd";
  // South Dakota has one at-large congressional district.
  if (/^(UNITED STATES )?REPRESENTATIVE( IN CONGRESS)?$/.test(o)) return "us-house-sd-01";
  return null;
}

export interface SdRosterRun {
  basis: "FILED";
  rosters: Roster[];
  candidateCount: number;
  /** Kept out of the roster and reported, never silently included or silently dropped. */
  withdrawn: Array<{ office: string; name: string }>;
  unmapped: Array<{ office: string; count: number }>;
}

export function toRosters(rows: SdCandidate[], sourceUrl: string, observedAt: Date): SdRosterRun {
  const byRace = new Map<string, Map<string, RosterEntry>>();
  const unmapped = new Map<string, number>();
  const withdrawn: SdRosterRun["withdrawn"] = [];

  for (const c of rows) {
    // A withdrawn candidate is not on the roster and is not forgotten either. It
    // goes in the run's own report so a person can see who left and why the count
    // moved, rather than discovering a silent shrink later.
    if (c.isWithdrawn) {
      withdrawn.push({ office: c.office, name: c.name });
      continue;
    }
    const raceKey = raceKeyForOffice(c.office);
    if (!raceKey) {
      unmapped.set(c.office, (unmapped.get(c.office) ?? 0) + 1);
      continue;
    }
    const key = nameKey(c.name);
    const race = byRace.get(raceKey) ?? new Map<string, RosterEntry>();
    if (!race.has(key)) race.set(key, { key, name: c.name, sourceName: c.name, sourceUrl });
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
    rosters,
    candidateCount: rosters.reduce((n, r) => n + r.entries.length, 0),
    withdrawn,
    unmapped: [...unmapped.entries()].map(([office, count]) => ({ office, count })).sort((a, b) => b.count - a.count),
  };
}

export async function fetchSdRoster(
  eid: string,
  observedAt: Date,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<SdRosterRun> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = sdUrl(eid);
  const res = await fetchImpl(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`South Dakota returned ${res.status} for the candidate list`);
  const html = await res.text();

  const rows = parseSdTable(html);
  if (rows.length === 0) {
    throw new Error(
      `South Dakota page for election ${eid} produced no rows. It is an ASP.NET grid whose markup ` +
        `can change, so an empty parse is a failed fetch rather than an election with nobody running.`,
    );
  }
  return toRosters(rows, url, observedAt);
}
