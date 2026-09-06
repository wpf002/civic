/**
 * The certified ballot, from the Texas Secretary of State.
 *
 * This is the source that answers the question the FEC cannot: who is actually on
 * the November ballot. For TX-01 the FEC lists four statutory candidates and the
 * certified list has two. Publishing the first as "your choices" would be false in
 * every district in the state.
 *
 * Scope: federal, state and county offices across all 254 counties — 3,968 rows for
 * November 3, 2026. It contains NO city, school board or other political-subdivision
 * races; those are not in the state system at all and still need their own adapters.
 *
 * The endpoint is the JSON backend of the SOS candidate-search app. It is public and
 * unauthenticated but undocumented, so it is treated as a source that can change
 * shape without notice: every field is read defensively and a response that does not
 * look like the response is an error rather than an empty roster.
 *
 * PRIVACY. The raw response carries candidates' personal email addresses and home
 * mailing addresses — 1,999 and 2,438 of them respectively. None of that is needed to
 * say where someone stands on an issue, so it is dropped at the parse boundary, in
 * `stripPii`, before any other code in this process can see a row. It is never
 * stored, logged or diffed.
 */
import { nameKey, type Roster, type RosterEntry } from "../roster.js";

export const SOS_ENDPOINT =
  "https://goelect.txelections.civixapps.com/api-ivis-cbp/api/cbp/findQualifiedCandidates";

/** The 2026 general. The endpoint ignores an election filter and returns everything. */
export const NOVEMBER_2026 = 53815;

/** Exactly the fields this product has any business holding. */
export interface SosCandidate {
  idCandidate: number;
  idElection: number;
  fullName: string;
  lastName: string;
  party: string | null;
  officeName: string;
  officeType: string;
  isWriteIn: boolean;
  filedAt: string | null;
  active: boolean;
}

interface RawRow {
  idCandidate?: number;
  idElection?: number;
  txFullNameBallot?: string | null;
  txLastNameBallot?: string | null;
  cdParty?: string | null;
  txOfficeName?: string | null;
  txOfficeTypeName?: string | null;
  cdCandType?: string | null;
  cdStatus?: string | null;
  dtFiled?: string | null;
  flActive?: boolean | null;
  // Present in the response and deliberately never carried past this file.
  txEmail?: string | null;
  mailingAddress?: unknown;
  txOccupation?: string | null;
}

/**
 * Drop personal contact details and keep the ballot facts.
 *
 * Deliberately an allow-list, not a delete-list. A future field added upstream —
 * a phone number, a date of birth — is excluded by default rather than included
 * until someone notices.
 */
export function stripPii(row: RawRow): SosCandidate | null {
  const fullName = (row.txFullNameBallot ?? "").trim();
  const officeName = (row.txOfficeName ?? "").trim();
  if (!fullName || !officeName || typeof row.idCandidate !== "number") return null;

  return {
    idCandidate: row.idCandidate,
    idElection: row.idElection ?? 0,
    fullName,
    lastName: (row.txLastNameBallot ?? "").trim(),
    party: row.cdParty ? row.cdParty.trim() : null,
    officeName,
    // The API returns both "State" and "State " for the same thing.
    officeType: (row.txOfficeTypeName ?? "").trim(),
    isWriteIn: row.cdCandType === "WRTIN",
    filedAt: row.dtFiled ?? null,
    active: row.flActive !== false,
  };
}

/**
 * Normalize a ballot name.
 *
 * The SOS shouts names and sometimes double-spaces them ("YOLANDA R.  PRINCE"), and
 * carries quoted nicknames. Casing and spacing are fixed; nothing else is touched.
 */
export function formatBallotName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s('"-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c: string) => "Mc" + c.toUpperCase())
    .replace(/\b([IVX]{2,})\b/gi, (m) => m.toUpperCase());
}

/**
 * Map an office name to a race key.
 *
 * Only offices this product already models return a key. Everything else returns
 * null and is reported as unmapped rather than guessed at — a county constable
 * roster attached to the wrong race is worse than one that waits.
 */
export function raceKeyForOffice(officeName: string): string | null {
  const o = officeName.toUpperCase().replace(/\s+/g, " ").trim();
  const house = o.match(/^U\.\s*S\.\s*REPRESENTATIVE DISTRICT (\d{1,2})$/);
  if (house) return `us-house-tx-${String(Number(house[1])).padStart(2, "0")}`;
  if (/^U\.\s*S\.\s*SENATOR$/.test(o)) return "us-senate-tx";
  return null;
}

export interface SosRosterRun {
  /** CERTIFIED, which is the point of this source. */
  basis: "CERTIFIED";
  rosters: Roster[];
  candidateCount: number;
  /** Offices with no race in this product yet, with how many candidates each has. */
  unmapped: Array<{ officeName: string; officeType: string; count: number }>;
}

/** Turn certified rows into rosters. Pure; no network. */
export function toRosters(
  rows: SosCandidate[],
  electionId: number,
  observedAt: Date,
): SosRosterRun {
  const byRace = new Map<string, RosterEntry[]>();
  const unmappedCounts = new Map<string, { officeName: string; officeType: string; count: number }>();

  for (const c of rows) {
    if (c.idElection !== electionId) continue;
    if (!c.active) continue;

    const raceKey = raceKeyForOffice(c.officeName);
    if (!raceKey) {
      const k = c.officeName;
      const prior = unmappedCounts.get(k);
      if (prior) prior.count++;
      else unmappedCounts.set(k, { officeName: c.officeName, officeType: c.officeType, count: 1 });
      continue;
    }

    const name = formatBallotName(c.fullName);
    const list = byRace.get(raceKey) ?? [];
    list.push({
      key: nameKey(name),
      name,
      // The certified spelling IS the ballot spelling. That is what displayName means.
      displayName: name,
      sourceName: c.fullName,
      isWriteIn: c.isWriteIn,
      externalIds: { txsos: String(c.idCandidate) },
      sourceUrl: SOS_ENDPOINT,
    });
    byRace.set(raceKey, list);
  }

  const rosters = [...byRace.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([raceKey, entries]) => ({
      raceKey,
      entries: entries.sort((a, b) => (a.sourceName ?? a.name).localeCompare(b.sourceName ?? b.name)),
      sourceUrl: SOS_ENDPOINT,
      observedAt,
    }));

  return {
    basis: "CERTIFIED",
    rosters,
    candidateCount: rosters.reduce((n, r) => n + r.entries.length, 0),
    unmapped: [...unmappedCounts.values()].sort((a, b) => b.count - a.count),
  };
}

/**
 * Fetch the certified list.
 *
 * The endpoint returns roughly 25 MB covering every election back to 2019 and
 * intermittently 500s under load, so this retries and then filters client-side.
 */
export async function fetchCertifiedRoster(
  electionId: number,
  observedAt: Date,
  opts: {
    fetchImpl?: typeof fetch;
    retries?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<SosRosterRun> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 4;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let raw: unknown;
  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(SOS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      raw = await res.json();
      lastError = "";
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(1000 * 2 ** attempt);
    }
  }
  if (lastError) throw new Error(`Texas SOS candidate endpoint failed: ${lastError}`);

  if (!Array.isArray(raw)) {
    throw new Error(
      "Texas SOS returned something that is not an array of candidates. This endpoint is " +
        "undocumented and can change shape without notice, so this is treated as a failed " +
        "fetch rather than as an election with no candidates.",
    );
  }

  // PII is dropped here, before anything else in the process sees a row.
  const clean = (raw as RawRow[]).map(stripPii).filter((c): c is SosCandidate => c !== null);
  const forElection = clean.filter((c) => c.idElection === electionId);
  if (forElection.length === 0) {
    throw new Error(
      `Texas SOS returned ${clean.length} candidates but none for election ${electionId}. ` +
        `An empty roster for a certified election is a parse failure, not a finding.`,
    );
  }

  return toRosters(forElection, electionId, observedAt);
}
