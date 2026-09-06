/**
 * Federal candidates from the FEC, for the US House and Senate races in one state.
 *
 * What this source is, precisely: everyone who has filed a Statement of Candidacy
 * with the FEC and is still a statutory candidate. That is NOT the November ballot.
 * TX-01 shows four active filers for one seat; the general election will have two.
 * Primary losers, withdrawn candidates and people who filed and never campaigned all
 * appear here, and the API carries no field that distinguishes them — ballot
 * qualification is the state's determination, not the FEC's.
 *
 * So these rosters are FILED, in exactly the sense the Dallas City Secretary adapter
 * uses the word, and nothing here may be displayed as "on the ballot". A certified
 * federal roster has to come from the Texas Secretary of State.
 *
 * Docs: https://api.open.fec.gov/developers/
 */
import { nameKey, type Roster, type RosterEntry } from "../roster.js";

const API = "https://api.open.fec.gov/v1";

/** Honorifics the FEC appends to the given-name field. Not part of a person's name. */
const HONORIFICS = new Set(["MR", "MRS", "MS", "MISS", "DR", "REV", "HON", "SEN", "REP"]);

/** Generational suffixes, which are, and which belong at the end. */
const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V", "VI"]);

const ROMAN = new Set(["II", "III", "IV", "V", "VI"]);

/** Title-case one token, leaving internal punctuation and casing conventions intact. */
function titleToken(t: string): string {
  const bare = t.replace(/\.$/, "");
  if (ROMAN.has(bare.toUpperCase())) return bare.toUpperCase();
  // Split on hyphens and apostrophes so SMITH-JONES and O'BRIEN both come out right.
  return t
    .toLowerCase()
    .replace(/(^|[-'’])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase())
    // McKinney, not Mckinney. Deliberately not applied to "Mac", where it would turn
    // Macy into MacY and similar ordinary surnames into nonsense.
    .replace(/^Mc([a-z])/, (_, c: string) => "Mc" + c.toUpperCase());
}

/**
 * "CAIN, BRISCOE ROWELL III" -> "Briscoe Rowell Cain III".
 *
 * The FEC stores "SURNAME, GIVEN NAMES [HONORIFIC] [SUFFIX]" in one field, in caps,
 * with the pieces in no fixed order. Displaying that string as-is puts a shouted,
 * reversed name in front of a voter, so it is parsed — carefully, because a mangled
 * name is a real defect and the original is kept alongside it.
 */
export function formatFecName(raw: string): string {
  const [surnamePart = "", givenPart = ""] = raw.split(",", 2).map((s) => s.trim());

  const collect = (s: string) => {
    const kept: string[] = [];
    const suffixes: string[] = [];
    for (const tok of s.split(/\s+/).filter(Boolean)) {
      const bare = tok.replace(/[.]/g, "").toUpperCase();
      if (HONORIFICS.has(bare)) continue;
      if (SUFFIXES.has(bare)) {
        suffixes.push(ROMAN.has(bare) ? bare : titleToken(tok.replace(/\.$/, "")) + ".");
        continue;
      }
      kept.push(titleToken(tok));
    }
    return { kept, suffixes };
  };

  const surname = collect(surnamePart);
  const given = collect(givenPart);
  const suffixes = [...given.suffixes, ...surname.suffixes];

  const name = [...given.kept, ...surname.kept, ...suffixes].join(" ").replace(/\s+/g, " ").trim();
  // Never return an empty name from a non-empty input: fall back to the source string.
  return name || raw;
}

export interface FecCandidate {
  candidate_id: string;
  name: string;
  party: string | null;
  party_full: string | null;
  office: string;
  district: string | null;
  state: string;
  candidate_status: string;
  incumbent_challenge_full: string | null;
  first_file_date: string | null;
  has_raised_funds: boolean | null;
}

export interface FecPage {
  results: FecCandidate[];
  pagination: { count: number; page: number; pages: number; per_page: number };
}

export const raceKeyFor = (office: string, state: string, district?: string | null): string =>
  office === "S"
    ? `us-senate-${state.toLowerCase()}`
    : `us-house-${state.toLowerCase()}-${String(district ?? "").padStart(2, "0")}`;

/** The page a roster cites. FEC has no per-candidate public page, so cite the query. */
export const sourceUrlFor = (state: string, cycle: number, office: string): string =>
  `${API}/candidates/?state=${state}&election_year=${cycle}&office=${office}&candidate_status=C`;

/**
 * Turn FEC records into rosters, one per race.
 *
 * Pure: no network. Everything network-shaped is in `fetchFederalRosters`.
 */
export interface MergedFiling {
  raceKey: string;
  name: string;
  /** Every FEC id that collapsed into one entry. */
  candidateIds: string[];
}

export function toRosters(
  candidates: FecCandidate[],
  state: string,
  cycle: number,
  observedAt: Date,
  merged: MergedFiling[] = [],
): Roster[] {
  const byRace = new Map<string, Map<string, RosterEntry & { fecIds: string[]; filed: string }>>();

  for (const c of candidates) {
    if (c.candidate_status !== "C") continue; // not a current statutory candidate
    if (c.office !== "H" && c.office !== "S") continue; // presidential is out of scope
    const raceKey = raceKeyFor(c.office, state, c.district);
    const name = formatFecName(c.name);

    // One person may hold more than one FEC id in the same race: Chelsey Hockett
    // refiled in TX-05 three weeks after her first Statement of Candidacy and the API
    // returns both, which printed her name twice on the roster. Collapse by name AND
    // party — two records that disagree on party are two people, not one refiling,
    // and merging those would delete a candidate.
    const dedupeKey = `${nameKey(name)}|${c.party ?? ""}`;
    const race = byRace.get(raceKey) ?? new Map();
    const prior = race.get(dedupeKey);

    if (prior) {
      prior.fecIds.push(c.candidate_id);
      // Keep the earliest filing as the entry of record, as the City Secretary
      // adapter does: the original filing is the one with the longer paper trail.
      if ((c.first_file_date ?? "9999") < prior.filed) {
        prior.filed = c.first_file_date ?? prior.filed;
        prior.sourceUrl = `https://www.fec.gov/data/candidate/${c.candidate_id}/`;
      }
    } else {
      race.set(dedupeKey, {
        key: nameKey(name),
        name,
        // Keep the source's own rendering. A parsed name is a derived value and the
        // thing it was derived from should survive next to it.
        sourceName: c.name,
        sourceUrl: `https://www.fec.gov/data/candidate/${c.candidate_id}/`,
        fecIds: [c.candidate_id],
        filed: c.first_file_date ?? "9999",
      });
    }
    byRace.set(raceKey, race);
  }

  // A collapse is never silent. If two records were wrongly merged, the only way
  // anyone finds out is by seeing that a merge happened.
  for (const [raceKey, race] of byRace) {
    for (const e of race.values()) {
      if (e.fecIds.length > 1) merged.push({ raceKey, name: e.name, candidateIds: [...e.fecIds] });
    }
  }

  return [...byRace.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([raceKey, race]) => ({
      raceKey,
      // Surname order, taken from the FEC's own surname-first string rather than from
      // the parsed name — sorting the display form puts "Dax" before "Ray" and reads
      // as an arbitrary order. This roster carries no ballot order: the FEC does not
      // know one, and inventing a sequence would imply a ballot position we cannot see.
      entries: [...race.values()]
        .sort((a, b) => (a.sourceName ?? a.name).localeCompare(b.sourceName ?? b.name))
        .map(({ fecIds, filed, ...entry }) => {
          void fecIds;
          void filed;
          return entry;
        }),
      sourceUrl: sourceUrlFor(state, cycle, raceKey.startsWith("us-senate") ? "S" : "H"),
      observedAt,
    }));
}

export interface FederalRosterRun {
  /** Always FILED. The FEC does not know who qualified for a ballot. */
  basis: "FILED";
  rosters: Roster[];
  candidateCount: number;
  /** People who held more than one FEC id in the same race. Reported, never hidden. */
  merged: MergedFiling[];
}

/** Fetch every page for one office. Throws rather than returning a short list. */
async function fetchOffice(
  state: string,
  cycle: number,
  office: "H" | "S",
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<FecCandidate[]> {
  const out: FecCandidate[] = [];
  let page = 1;
  let pages = 1;

  do {
    const url =
      `${API}/candidates/?api_key=${encodeURIComponent(apiKey)}&state=${state}` +
      `&election_year=${cycle}&office=${office}&candidate_status=C&per_page=100&page=${page}&sort=name`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`FEC returned ${res.status} for ${office} page ${page}`);
    const body = (await res.json()) as FecPage & { error?: unknown };
    if (body.error) throw new Error(`FEC error: ${JSON.stringify(body.error)}`);
    if (!Array.isArray(body.results)) throw new Error(`FEC page ${page} had no results array`);

    out.push(...body.results);
    pages = body.pagination?.pages ?? 1;
    // A truncated fetch looks exactly like a race losing candidates. Refuse to guess.
    if (page === pages && out.length < (body.pagination?.count ?? 0)) {
      throw new Error(
        `FEC said ${body.pagination.count} candidates for ${office} but ${out.length} arrived. ` +
          `A short roster is indistinguishable from candidates disappearing, so this is an error.`,
      );
    }
    page++;
  } while (page <= pages);

  return out;
}

export async function fetchFederalRosters(
  state: string,
  cycle: number,
  observedAt: Date,
  opts: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<FederalRosterRun> {
  const apiKey = opts.apiKey ?? process.env.FEC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FEC_API_KEY is not set. Get a free key instantly at https://api.data.gov/signup/ — " +
        "DEMO_KEY works for a handful of calls but is rate-limited well below one full state.",
    );
  }
  const fetchImpl = opts.fetchImpl ?? fetch;

  const [house, senate] = await Promise.all([
    fetchOffice(state, cycle, "H", apiKey, fetchImpl),
    fetchOffice(state, cycle, "S", apiKey, fetchImpl),
  ]);
  const all = [...house, ...senate];

  const merged: MergedFiling[] = [];
  const rosters = toRosters(all, state, cycle, observedAt, merged);
  return { basis: "FILED", rosters, candidateCount: all.length, merged };
}
