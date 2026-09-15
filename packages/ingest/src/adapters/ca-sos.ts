/**
 * California's certified list of candidates for the November 3 2026 general election.
 *
 * Published by the Secretary of State as a PDF and nothing else, certified August 27
 * 2026. California's primary is top-two, so every partisan contest on the general
 * ballot has two candidates (one where only one advanced), and they can share a
 * party. That makes the party-duplicate test other states use meaningless here; the
 * certification is the basis, and the one-or-two rule is the check that the PDF was
 * read correctly.
 *
 * READING THE PDF. Text comes out as lines by vertical position. Each candidate is a
 * name line ("Roger Niello * Republican") followed by a ballot designation line
 * ("California State Senator"). Sometimes the party lands on its own line above the
 * name. A contest that does not come out as one or two candidates is reported and
 * left out, never guessed at: a designation read as a name puts an occupation on the
 * ballot page.
 *
 * Judicial retention questions ("Shall Associate Justice ... be elected") are not
 * contests between candidates and are skipped. The Board of Equalization is drawn on
 * its own districts and stays unmapped.
 */
import { nameKey, normalizeParty, type Roster, type RosterEntry } from "../roster.js";
import { keyForSpec, legislativeSpec, statewideSpec, type OfficeSpec } from "../state-office-specs.js";

export const CA_CERT_LIST = "https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/cert-list-candidates.pdf";

const PARTIES = ["No Party Preference", "American Independent", "Peace and Freedom", "Democratic", "Republican", "Libertarian", "Green"];
const PARTY_ALT = PARTIES.map((p) => p.replace(/ /g, "\\s+")).join("|");
const PARTY_ONLY = new RegExp(`^(${PARTY_ALT})$`);
const NAME_WITH_PARTY = new RegExp(`^(.+?)\\s*(\\*)?\\s+(${PARTY_ALT})$`);

const STATEWIDE = ["Governor", "Lieutenant Governor", "Secretary of State", "Controller", "Treasurer", "Attorney General", "Insurance Commissioner"];
const NONPARTISAN_STATEWIDE = ["Superintendent of Public Instruction"];

interface Heading {
  raceKey: string;
  spec: OfficeSpec | null;
  partisan: boolean;
}

export function headingFor(line: string): Heading | null {
  const house = line.match(/^United States Representative District (\d{1,2})$/);
  if (house) return { raceKey: `us-house-ca-${house[1]!.padStart(2, "0")}`, spec: null, partisan: true };
  const senate = line.match(/^State Senate District (\d{1,2})$/);
  if (senate) {
    const spec = legislativeSpec("upper", String(Number(senate[1])));
    return { raceKey: keyForSpec("CA", spec), spec, partisan: true };
  }
  const assembly = line.match(/^State Assembly Member District (\d{1,2})$/);
  if (assembly) {
    const spec = legislativeSpec("lower", String(Number(assembly[1])));
    return { raceKey: keyForSpec("CA", spec), spec, partisan: true };
  }
  if (line === "Governor") return { raceKey: "governor-ca", spec: null, partisan: true };
  if (STATEWIDE.includes(line)) {
    const spec = statewideSpec(line);
    return { raceKey: keyForSpec("CA", spec), spec, partisan: true };
  }
  if (NONPARTISAN_STATEWIDE.includes(line)) {
    const spec = statewideSpec(line);
    return { raceKey: keyForSpec("CA", spec), spec, partisan: false };
  }
  return null;
}

/** Lines that end a contest without being one: page furniture and the next section. */
const isFurniture = (l: string) =>
  /^General Election - November 3, 2026$/.test(l) ||
  /^Official Certified List of Candidates$/.test(l) ||
  /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(l) ||
  /^Page \d+ of \d+$/.test(l) ||
  /^\* Incumbent$/.test(l);

/** Headings of sections this adapter does not read; a contest's candidates stop there. */
const isOtherSection = (l: string) =>
  /^Board of Equalization Member District \d+$/.test(l) || /^•|^Shall |^Court of Appeal|^Supreme Court/.test(l);

export interface CaRosterRun {
  basis: "CERTIFIED";
  rosters: Roster[];
  candidateCount: number;
  offices: Map<string, OfficeSpec>;
  /** Contests that did not read as one or two candidates, with what was read. */
  rejected: Array<{ raceKey: string; read: string[] }>;
  /** Contests with a single candidate, listed so a person can confirm against the PDF. */
  unopposed: string[];
}

export function parseCertifiedList(lines: string[], observedAt: Date): CaRosterRun {
  const rosters: Roster[] = [];
  const offices = new Map<string, OfficeSpec>();
  const rejected: CaRosterRun["rejected"] = [];
  const unopposed: string[] = [];

  let current: Heading | null = null;
  let body: string[] = [];

  const close = () => {
    if (!current) return;
    const entries = readCandidates(body, current.partisan);
    const names = entries.map((e) => e.name);
    // Two, or one when the primary produced only one. Anything else is a misread.
    if (entries.length < 1 || entries.length > 2) {
      rejected.push({ raceKey: current.raceKey, read: names });
    } else {
      if (entries.length === 1) unopposed.push(current.raceKey);
      rosters.push({ raceKey: current.raceKey, entries, sourceUrl: CA_CERT_LIST, observedAt });
      if (current.spec) offices.set(current.raceKey, current.spec);
    }
    current = null;
    body = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || isFurniture(line)) continue;
    const heading = headingFor(line);
    if (heading) {
      close();
      current = heading;
      continue;
    }
    if (isOtherSection(line)) {
      close();
      continue;
    }
    if (current) body.push(line);
  }
  close();

  return {
    basis: "CERTIFIED",
    rosters,
    candidateCount: rosters.reduce((n, r) => n + r.entries.length, 0),
    offices,
    rejected,
    unopposed,
  };
}

/**
 * Candidates from a contest's lines: name lines, each followed by a designation.
 *
 * A partisan name line carries its party, or has it on the line just above. A
 * nonpartisan contest has no party at all, so its lines strictly alternate.
 */
export function readCandidates(body: string[], partisan: boolean): RosterEntry[] {
  const out: RosterEntry[] = [];
  let pendingParty: string | null = null;
  let expectName = true;
  for (const line of body) {
    if (partisan) {
      const only = line.match(PARTY_ONLY);
      if (only) {
        pendingParty = only[1]!;
        continue;
      }
      const withParty = line.match(NAME_WITH_PARTY);
      if (withParty) {
        out.push(entry(withParty[1]!, withParty[3]!));
        pendingParty = null;
        expectName = false;
        continue;
      }
      if (pendingParty && expectName) {
        out.push(entry(line.replace(/\s*\*$/, ""), pendingParty));
        pendingParty = null;
        expectName = false;
        continue;
      }
      // A designation line. The next line starts a new candidate.
      expectName = true;
      continue;
    }
    if (expectName) out.push(entry(line.replace(/\s+Non-Partisan$/i, "").replace(/\s*\*$/, ""), null));
    expectName = !expectName;
  }
  return out;
}

function entry(rawName: string, party: string | null): RosterEntry {
  const name = rawName.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim();
  return {
    key: nameKey(name),
    name,
    displayName: name,
    sourceName: rawName,
    party: normalizeParty(party),
    sourceUrl: CA_CERT_LIST,
  };
}

/** PDF text as lines, top to bottom, items on a line joined left to right. */
export async function pdfLines(data: Uint8Array): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data, verbosity: 0 }).promise;
  const out: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const text = await (await doc.getPage(n)).getTextContent();
    const rows = new Map<number, Array<{ x: number; s: string }>>();
    for (const item of text.items as Array<{ str: string; transform: number[] }>) {
      const y = Math.round(item.transform[5]!);
      const row = rows.get(y) ?? [];
      row.push({ x: item.transform[4]!, s: item.str });
      rows.set(y, row);
    }
    for (const [, parts] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      out.push(parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim());
    }
  }
  return out;
}

export async function fetchCaRoster(observedAt: Date, fetchImpl: typeof fetch = fetch): Promise<CaRosterRun> {
  const res = await fetchImpl(CA_CERT_LIST);
  if (!res.ok) throw new Error(`California certified list returned ${res.status}`);
  return parseCertifiedList(await pdfLines(new Uint8Array(await res.arrayBuffer())), observedAt);
}
