/**
 * North Carolina candidate filings, from the State Board of Elections.
 *
 * One public CSV, no key, covering every contest in the state — including the layer
 * Texas has nothing for. NC lists town mayors, town councils, county sheriffs and
 * clerks of court alongside federal and state offices. That is why this state is the
 * second adapter: it tests whether the same shape works for municipal races.
 *
 *   https://s3.amazonaws.com/dl.ncsbe.gov/Elections/2026/Candidate%20Filing/
 *
 * The file is per-county, so a statewide contest repeats once per county in which it
 * appears: US SENATE arrives 400 times for four candidates across 100 counties.
 * Rows are collapsed on contest plus ballot name.
 *
 * Basis is FILED, not certified. This is the filing list; a candidate who loses a
 * primary still appears. NC publishes certified ballots separately.
 *
 * PRIVACY: the CSV carries each candidate's home street address, zip, personal phone
 * and email. None of that is needed to say where someone stands, so it is dropped in
 * `stripPii` before anything else reads a row — same rule as the Texas adapter.
 */
import { nameKey, type Roster, type RosterEntry } from "../roster.js";

export const NC_FILING_INDEX = "https://s3.amazonaws.com/dl.ncsbe.gov/Elections/2026/Candidate%20Filing/";
export const NC_CANDIDATE_CSV = `${NC_FILING_INDEX}Candidate_Listing_2026.csv`;

export interface NcCandidate {
  electionDate: string;
  county: string;
  contest: string;
  ballotName: string;
  party: string | null;
  isPartisan: boolean;
  voteFor: number;
  filedAt: string | null;
}

/** Allow-list. A column added upstream is excluded until someone decides otherwise. */
export function stripPii(row: Record<string, string>): NcCandidate | null {
  const contest = (row.contest_name ?? "").trim();
  const ballotName = (row.name_on_ballot ?? "").trim();
  if (!contest || !ballotName) return null;
  return {
    electionDate: (row.election_dt ?? "").trim(),
    county: (row.county_name ?? "").trim(),
    contest,
    ballotName,
    party: (row.party_candidate ?? "").trim() || null,
    isPartisan: (row.is_partisan ?? "").toUpperCase() === "TRUE",
    voteFor: Number(row.vote_for) || 1,
    filedAt: (row.candidacy_dt ?? "").trim() || null,
  };
}

/** Minimal RFC4180 reader: the file is quoted and contains commas inside fields. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const header = (rows.shift() ?? []).map((h) => h.replace(/^﻿/, "").trim());
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** "Nov 3 2026" as the file writes it. */
export const NOVEMBER_2026 = "11/03/2026";

/**
 * Map a contest name to a race key.
 *
 * Federal contests map onto the keys this product already uses. State, county and
 * municipal contests return null and are counted as unmapped — the offices do not
 * exist in the database yet, and attaching a roster to a race that does not exist is
 * worse than reporting that it is missing.
 */
export function raceKeyForContest(contest: string): string | null {
  const c = contest.toUpperCase().replace(/\s+/g, " ").trim();
  const house = c.match(/^US HOUSE OF REPRESENTATIVES DISTRICT (\d{1,2})$/);
  if (house) return `us-house-nc-${String(Number(house[1])).padStart(2, "0")}`;
  if (c === "US SENATE") return "us-senate-nc";
  return null;
}

/** Title-case a shouted ballot name without touching what is inside it. */
export function formatBallotName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export interface NcRosterRun {
  basis: "FILED";
  rosters: Roster[];
  candidateCount: number;
  /** Contests with no race modelled yet, most common first. */
  unmapped: Array<{ contest: string; count: number }>;
  /** How many raw rows collapsed into each candidate, i.e. counties per contest. */
  collapsedRows: number;
}

export function toRosters(rows: NcCandidate[], electionDate: string, observedAt: Date): NcRosterRun {
  const byRace = new Map<string, Map<string, RosterEntry>>();
  const unmapped = new Map<string, number>();
  let collapsedRows = 0;

  for (const r of rows) {
    if (r.electionDate !== electionDate) continue;

    const raceKey = raceKeyForContest(r.contest);
    if (!raceKey) {
      unmapped.set(r.contest, (unmapped.get(r.contest) ?? 0) + 1);
      continue;
    }

    const name = formatBallotName(r.ballotName);
    const key = nameKey(name);
    const race = byRace.get(raceKey) ?? new Map<string, RosterEntry>();
    if (race.has(key)) {
      // The same person in another county's copy of a statewide contest.
      collapsedRows++;
    } else {
      race.set(key, { key, name, sourceName: r.ballotName, sourceUrl: NC_CANDIDATE_CSV });
    }
    byRace.set(raceKey, race);
  }

  const rosters = [...byRace.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([raceKey, race]) => ({
      raceKey,
      entries: [...race.values()].sort((a, b) => a.name.localeCompare(b.name)),
      sourceUrl: NC_CANDIDATE_CSV,
      observedAt,
    }));

  return {
    basis: "FILED",
    rosters,
    candidateCount: rosters.reduce((n, r) => n + r.entries.length, 0),
    unmapped: [...unmapped.entries()]
      .map(([contest, count]) => ({ contest, count }))
      .sort((a, b) => b.count - a.count),
    collapsedRows,
  };
}

export async function fetchNcRoster(
  electionDate: string,
  observedAt: Date,
  opts: { fetchImpl?: typeof fetch; url?: string } = {},
): Promise<NcRosterRun> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(opts.url ?? NC_CANDIDATE_CSV, { redirect: "follow" });
  if (!res.ok) throw new Error(`NC SBE returned ${res.status} for the candidate listing`);
  const text = await res.text();

  // A truncated or replaced file must not read as a state with fewer candidates.
  // Checked on the PARSED header rather than the raw bytes: the byte check was
  // matching on the file's quoting style, which is not something we get to rely on.
  const parsed = parseCsv(text);
  const REQUIRED = ["election_dt", "contest_name", "name_on_ballot"];
  const missing = REQUIRED.filter((c) => !(parsed[0] && c in parsed[0]));
  if (parsed.length === 0 || missing.length > 0) {
    throw new Error(
      `NC candidate CSV is missing expected columns (${missing.join(", ") || "no rows at all"}). ` +
        `Treating as a failed fetch rather than as an election with no candidates.`,
    );
  }

  const clean = parsed.map(stripPii).filter((c): c is NcCandidate => c !== null);
  const run = toRosters(clean, electionDate, observedAt);
  if (run.candidateCount === 0 && clean.length > 0) {
    throw new Error(
      `NC file parsed ${clean.length} candidates but none matched ${electionDate}. ` +
        `Check the election date rather than treating this as an empty roster.`,
    );
  }
  return run;
}
