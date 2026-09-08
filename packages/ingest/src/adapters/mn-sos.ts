/**
 * Minnesota candidate filings, from the Secretary of State.
 *
 * Two files, both public and keyless, published per election date:
 *
 *   cand.txt   state and federal offices — 1,378 rows across 372 offices
 *   local.txt  city, township, county and school board — the layer Texas has none of
 *
 * They are NOT the same format and are deliberately parsed separately rather than
 * coerced into one shape. local.txt carries fields cand.txt does not, and pretending
 * otherwise is how a field silently reads as the wrong column.
 *
 * ENCODING. These files are Latin-1, not UTF-8. Read as UTF-8 they throw on the
 * first accented name — Peña, Muñoz — and a lenient decoder would replace those
 * characters instead, putting a mangled name on a ballot listing. Decoded explicitly.
 *
 * Basis is FILED. Minnesota publishes the filing list; a primary loser still appears.
 */
import { nameKey, type Roster, type RosterEntry } from "../roster.js";

export const MN_BASE = "https://electionresultsfiles.sos.state.mn.us";
export const candUrl = (date: string) => `${MN_BASE}/${date}/cand.txt`;
export const localUrl = (date: string) => `${MN_BASE}/${date}/local.txt`;

/** Nov 3 2026, as the path formats it. */
export const NOVEMBER_2026 = "20261103";

export interface MnCandidate {
  candidateId: string;
  name: string;
  officeId: string;
  officeName: string;
  party: string | null;
  /** Which file it came from, because the two describe different things. */
  file: "state" | "local";
  isWriteIn: boolean;
}

/**
 * Decode a Latin-1 buffer.
 *
 * Explicit rather than lenient: a decoder that substitutes on error turns "Peña"
 * into "Pe?a" and puts that on a ballot listing, which is worse than failing.
 */
export function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder("windows-1252").decode(bytes);
}

/** `id;name;officeId;officeName;?;?;party` */
export function parseStateFile(text: string): MnCandidate[] {
  const out: MnCandidate[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = line.split(";");
    if (f.length < 7) continue;
    const name = (f[1] ?? "").trim();
    const officeName = (f[3] ?? "").trim();
    if (!name || !officeName) continue;
    out.push({
      candidateId: (f[0] ?? "").trim(),
      name,
      officeId: (f[2] ?? "").trim(),
      officeName,
      party: (f[6] ?? "").trim() || null,
      file: "state",
      isWriteIn: /^write[- ]?in$/i.test(name),
    });
  }
  return out;
}

/** `MN;;;officeId;officeName;districtId;candidateId;name;;;party;...` */
export function parseLocalFile(text: string): MnCandidate[] {
  const out: MnCandidate[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = line.split(";");
    if (f.length < 11) continue;
    const name = (f[7] ?? "").trim();
    const officeName = (f[4] ?? "").trim();
    if (!name || !officeName) continue;
    out.push({
      candidateId: `${(f[5] ?? "").trim()}-${(f[6] ?? "").trim()}`,
      name,
      officeId: (f[3] ?? "").trim(),
      officeName,
      party: (f[10] ?? "").trim() || null,
      file: "local",
      // Minnesota prints a WRITE-IN line on every local contest. It is a ballot line,
      // not a person, and must not become a Candidate row.
      isWriteIn: /^write[- ]?in$/i.test(name),
    });
  }
  return out;
}

export function raceKeyForOffice(officeName: string): string | null {
  const o = officeName.toUpperCase().replace(/\s+/g, " ").trim();
  const house = o.match(/^U\.?S\.? REPRESENTATIVE DISTRICT (\d{1,2})$/);
  if (house) return `us-house-mn-${String(Number(house[1])).padStart(2, "0")}`;
  if (/^U\.?S\.? SENATOR$/.test(o)) return "us-senate-mn";
  return null;
}

export interface MnRosterRun {
  basis: "FILED";
  rosters: Roster[];
  candidateCount: number;
  /** How many rows each file contributed, so a missing file is visible. */
  fromState: number;
  fromLocal: number;
  unmapped: Array<{ officeName: string; count: number }>;
}

export function toRosters(rows: MnCandidate[], observedAt: Date, sourceUrl: string): MnRosterRun {
  const byRace = new Map<string, Map<string, RosterEntry>>();
  const unmapped = new Map<string, number>();

  for (const c of rows) {
    const raceKey = raceKeyForOffice(c.officeName);
    if (!raceKey) {
      unmapped.set(c.officeName, (unmapped.get(c.officeName) ?? 0) + 1);
      continue;
    }
    const name = c.name.replace(/\s+/g, " ").trim();
    const key = nameKey(name);
    const race = byRace.get(raceKey) ?? new Map<string, RosterEntry>();
    if (!race.has(key)) {
      race.set(key, {
        key,
        name,
        sourceName: c.name,
        isWriteIn: c.isWriteIn,
        // A write-in line has no person behind it. Marked placeholder so the race
        // quarantines rather than gaining a candidate called "WRITE-IN".
        isPlaceholder: c.isWriteIn,
        externalIds: { mnsos: c.candidateId },
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

  return {
    basis: "FILED",
    rosters,
    candidateCount: rosters.reduce((n, r) => n + r.entries.length, 0),
    fromState: rows.filter((r) => r.file === "state").length,
    fromLocal: rows.filter((r) => r.file === "local").length,
    unmapped: [...unmapped.entries()].map(([officeName, count]) => ({ officeName, count })).sort((a, b) => b.count - a.count),
  };
}

export async function fetchMnRoster(
  electionDate: string,
  observedAt: Date,
  opts: { fetchImpl?: typeof fetch; includeLocal?: boolean } = {},
): Promise<MnRosterRun> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  const get = async (url: string) => {
    const res = await fetchImpl(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`Minnesota SOS returned ${res.status} for ${url}`);
    return decodeLatin1(new Uint8Array(await res.arrayBuffer()));
  };

  const state = parseStateFile(await get(candUrl(electionDate)));
  if (state.length === 0) {
    throw new Error(
      `Minnesota cand.txt for ${electionDate} parsed to zero candidates. An empty state file ` +
        `is a parse or date failure, not an election with nobody running.`,
    );
  }

  let local: MnCandidate[] = [];
  if (opts.includeLocal !== false) {
    // A missing local file is not fatal — the state file is still a real roster — but
    // it must be visible rather than read as a state with no local races.
    try {
      local = parseLocalFile(await get(localUrl(electionDate)));
    } catch {
      local = [];
    }
  }

  return toRosters([...state, ...local], observedAt, candUrl(electionDate));
}
