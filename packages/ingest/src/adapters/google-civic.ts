/**
 * The ballot for an address, from Google's Civic Information API.
 *
 * voterInfoQuery returns every contest on the ballot at an address — federal, state
 * and local — with the candidates, as supplied to Google by state and local election
 * officials through the Voting Information Project. It is the only national source of
 * who is actually on a ballot that needs no partnership.
 *
 * Coverage is by state and uneven: in the 2024 primaries California and Texas
 * supplied no contests at all. So a state with no contests here is reported, never
 * read as an empty ballot, and a state's own certified list (tx-sos, nc-sbe, ...)
 * outranks this wherever one exists.
 *
 * PRIVACY: a candidate record can carry a phone number and an email. Dropped at the
 * parse boundary by allow-list, the same rule as every state adapter.
 *
 * Docs: https://developers.google.com/civic-information/docs/v2/elections/voterInfoQuery
 */
import { stateByCode } from "@civic/core";
import { nameKey, normalizeParty, type Roster, type RosterEntry } from "../roster.js";

const API = "https://www.googleapis.com/civicinfo/v2";

export interface CivicElection {
  id: string;
  name: string;
  electionDay: string;
  ocdDivisionId: string;
}

/** Exactly what this product keeps from a candidate. */
export interface CivicCandidate {
  name: string;
  party: string | null;
  candidateUrl: string | null;
  channels: Array<{ type: string; id: string }>;
}

export interface CivicContest {
  office: string;
  level: string[];
  roles: string[];
  districtName: string | null;
  districtScope: string | null;
  districtId: string | null;
  candidates: CivicCandidate[];
  /** True only when every source Google names for the contest is an official one. */
  official: boolean;
}

interface RawContest {
  type?: string;
  office?: string;
  level?: string[];
  roles?: string[];
  district?: { name?: string; scope?: string; id?: string };
  candidates?: Array<{
    name?: string;
    party?: string;
    candidateUrl?: string;
    channels?: Array<{ type?: string; id?: string }>;
    // Present upstream and deliberately never read: phone, email, photoUrl.
  }>;
  sources?: Array<{ name?: string; official?: boolean }>;
}

export function parseContests(body: { contests?: RawContest[] }): CivicContest[] {
  const out: CivicContest[] = [];
  for (const c of body.contests ?? []) {
    // Referendums have no candidates; they are a different product question.
    if (c.type === "Referendum" || !c.office) continue;
    const candidates = (c.candidates ?? [])
      .filter((x) => x.name?.trim())
      .map((x) => ({
        name: x.name!.replace(/\s+/g, " ").trim(),
        party: x.party?.trim() || null,
        candidateUrl: /^https?:\/\//i.test(x.candidateUrl ?? "") ? x.candidateUrl!.trim() : null,
        channels: (x.channels ?? [])
          .filter((ch) => ch.type && ch.id)
          .map((ch) => ({ type: ch.type!, id: ch.id! })),
      }));
    out.push({
      office: c.office.trim(),
      level: c.level ?? [],
      roles: c.roles ?? [],
      districtName: c.district?.name ?? null,
      districtScope: c.district?.scope ?? null,
      districtId: c.district?.id ?? null,
      candidates,
      official: (c.sources ?? []).length > 0 && (c.sources ?? []).every((s) => s.official === true),
    });
  }
  return out;
}

/**
 * The race key for a contest this product models, or null.
 *
 * Read from roles, level and the OCD district id, never from the office's display
 * name, which each state words its own way ("U.S. Representative", "Representative
 * in Congress", "United States House of Representatives District 7").
 */
export function raceKeyForContest(state: string, c: CivicContest): string | null {
  const st = stateByCode(state);
  if (!st) return null;
  const code = st.code.toLowerCase();
  const federal = c.level.includes("country");
  const stateLevel = c.level.includes("administrativeArea1");

  if (federal && c.roles.includes("legislatorUpperBody")) return `us-senate-${code}`;
  if (federal && c.roles.includes("legislatorLowerBody")) {
    if (st.houseSeats === 1) return `us-house-${code}-00`;
    const cd = c.districtId?.match(/\/cd:(\d{1,2})$/)?.[1];
    return cd ? `us-house-${code}-${cd.padStart(2, "0")}` : null;
  }
  if (stateLevel && c.roles.includes("headOfGovernment")) return `governor-${code}`;
  return null;
}

export async function electionQuery(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<CivicElection[]> {
  const res = await fetchImpl(`${API}/elections?key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw new Error(`civicinfo elections returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { elections?: CivicElection[] };
  return body.elections ?? [];
}

export interface VoterInfo {
  electionId: string | null;
  contests: CivicContest[];
}

export async function voterInfo(
  address: string,
  electionId: string,
  apiKey: string,
  opts: { officialOnly?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<VoterInfo> {
  const qs = new URLSearchParams({ address, electionId, key: apiKey });
  if (opts.officialOnly) qs.set("officialOnly", "true");
  const res = await (opts.fetchImpl ?? fetch)(`${API}/voterinfo?${qs}`);
  // 400 with "Election unknown" or "No address matches": no ballot data for this
  // address, which is a coverage fact and not a failure of the run.
  if (res.status === 400 || res.status === 404) return { electionId: null, contests: [] };
  if (!res.ok) throw new Error(`civicinfo voterinfo returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { election?: { id?: string }; contests?: RawContest[] };
  return { electionId: body.election?.id ?? null, contests: parseContests(body) };
}

export interface CivicRosterRun {
  rosters: Roster[];
  /** Whether every contest that became a roster came from an official source. */
  allOfficial: boolean;
  /** Seats where two addresses returned different candidate lists. Never merged. */
  conflicts: string[];
  unmapped: Map<string, number>;
  /** Campaign websites as the election officials supplied them. */
  websites: Array<{ raceKey: string; key: string; url: string }>;
}

/**
 * Combine the contests read at many addresses into one roster per race.
 *
 * Every address in a district should return the same candidates. When two do not,
 * the race is reported as a conflict and left out, because picking one would decide
 * a ballot by which library happened to be asked first.
 */
export function toRosters(
  state: string,
  readings: Array<{ address: string; contests: CivicContest[] }>,
  sourceUrl: string,
  observedAt: Date,
): CivicRosterRun {
  const byRace = new Map<string, { entries: RosterEntry[]; signature: string; official: boolean }>();
  const conflicts = new Set<string>();
  const unmapped = new Map<string, number>();
  const websites: CivicRosterRun["websites"] = [];

  for (const reading of readings) {
    for (const c of reading.contests) {
      const raceKey = raceKeyForContest(state, c);
      if (!raceKey) {
        unmapped.set(c.office, (unmapped.get(c.office) ?? 0) + 1);
        continue;
      }
      const entries: RosterEntry[] = c.candidates.map((x) => ({
        key: nameKey(x.name),
        name: x.name,
        displayName: x.name,
        sourceName: x.name,
        party: normalizeParty(x.party),
        sourceUrl,
      }));
      for (const x of c.candidates) {
        if (x.candidateUrl) websites.push({ raceKey, key: nameKey(x.name), url: x.candidateUrl });
      }
      const signature = entries.map((e) => e.key).sort().join("|");
      const prior = byRace.get(raceKey);
      if (!prior) byRace.set(raceKey, { entries, signature, official: c.official });
      else if (prior.signature !== signature) conflicts.add(raceKey);
    }
  }

  const rosters = [...byRace.entries()]
    .filter(([raceKey]) => !conflicts.has(raceKey))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([raceKey, r]) => ({
      raceKey,
      entries: [...r.entries].sort((a, b) => a.name.localeCompare(b.name)),
      sourceUrl,
      observedAt,
    }));

  return {
    rosters,
    allOfficial: [...byRace.entries()].filter(([k]) => !conflicts.has(k)).every(([, r]) => r.official),
    conflicts: [...conflicts],
    unmapped,
    websites: websites.filter((w) => !conflicts.has(w.raceKey)),
  };
}
