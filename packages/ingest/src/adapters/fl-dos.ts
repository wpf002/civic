/**
 * Florida's state and federal candidates for the November 3 2026 general election,
 * from the Division of Elections' candidate extract.
 *
 * One tab-delimited file, public and keyless, requested by election id. It lists
 * everyone who ever filed for the election with a status. After the August primary
 * the ballot is exactly the rows marked Qualified: primary losers are Defeated, and a
 * candidate with no opponent is Unopposed and does not appear on the ballot at all.
 *
 * PRIVACY: the extract carries each candidate's street address, phone, email, voter
 * id and treasurer. Dropped at the parse boundary by allow-list.
 */
import { nameKey, normalizeParty, type Roster, type RosterEntry } from "../roster.js";
import { keyForSpec, legislativeSpec, statewideSpec, type OfficeSpec } from "../state-office-specs.js";

export const FL_EXTRACT = "https://dos.elections.myflorida.com/candidates/extractCanList.asp";
export const FL_GENERAL_2026 = "20261103-GEN";

export interface FlCandidate {
  officeCode: string;
  district: string | null;
  status: string;
  partyCode: string | null;
  name: string;
}

/** Allow-list. Address, phone, email, voter id and treasurer never leave this function. */
export function parseExtract(tsv: string): FlCandidate[] {
  const lines = tsv.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const header = (lines.shift() ?? "").split("\t");
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Florida extract has no ${name} column`);
    return i;
  };
  const c = {
    office: col("OfficeCode"),
    district: col("Juris1num"),
    status: col("StatusDesc"),
    party: col("PartyCode"),
    last: col("NameLast"),
    first: col("NameFirst"),
    middle: col("NameMiddle"),
  };
  const out: FlCandidate[] = [];
  for (const line of lines) {
    const f = line.split("\t");
    const name = [f[c.first], f[c.middle], f[c.last]].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
    if (!name) continue;
    out.push({
      officeCode: (f[c.office] ?? "").trim(),
      district: (f[c.district] ?? "").trim() || null,
      status: (f[c.status] ?? "").trim(),
      partyCode: (f[c.party] ?? "").trim() || null,
      name: name.replace(/\s+/g, " "),
    });
  }
  return out;
}

const FL_PARTY: Record<string, string> = { NPA: "I", LPF: "L", CPF: "CON", FFP: "FWD", GRE: "G" };

export function raceKeyFor(c: FlCandidate): { raceKey: string; spec: OfficeSpec | null } | null {
  const d = c.district && /^\d+$/.test(c.district) ? String(Number(c.district)) : null;
  switch (c.officeCode) {
    case "USR":
      return d ? { raceKey: `us-house-fl-${d.padStart(2, "0")}`, spec: null } : null;
    case "USS":
      return { raceKey: "us-senate-fl", spec: null };
    case "GOV":
      return { raceKey: "governor-fl", spec: null };
    case "STS":
      return d ? spec(legislativeSpec("upper", d)) : null;
    case "STR":
      return d ? spec(legislativeSpec("lower", d)) : null;
    case "ATG":
      return spec(statewideSpec("Attorney General"));
    case "CFO":
      return spec(statewideSpec("Chief Financial Officer"));
    case "AGR":
      return spec(statewideSpec("Commissioner of Agriculture"));
    default:
      // Courts, state attorneys, public defenders and special districts have their own
      // circuits and districts.
      return null;
  }
}

const spec = (s: OfficeSpec) => ({ raceKey: keyForSpec("FL", s), spec: s });

export interface FlRosterRun {
  basis: "CERTIFIED";
  rosters: Roster[];
  candidateCount: number;
  offices: Map<string, OfficeSpec>;
  unmapped: Array<{ office: string; count: number }>;
}

export function toRosters(rows: FlCandidate[], sourceUrl: string, observedAt: Date): FlRosterRun {
  const byRace = new Map<string, Map<string, RosterEntry>>();
  const offices = new Map<string, OfficeSpec>();
  const unmapped = new Map<string, number>();

  for (const c of rows) {
    if (c.status !== "Qualified") continue;
    const mapped = raceKeyFor(c);
    if (!mapped) {
      unmapped.set(c.officeCode, (unmapped.get(c.officeCode) ?? 0) + 1);
      continue;
    }
    if (mapped.spec) offices.set(mapped.raceKey, mapped.spec);
    const key = nameKey(c.name);
    const race = byRace.get(mapped.raceKey) ?? new Map<string, RosterEntry>();
    if (!race.has(key)) {
      const isWriteIn = c.partyCode === "WRI";
      race.set(key, {
        key,
        name: c.name,
        displayName: c.name,
        sourceName: c.name,
        isWriteIn,
        party: isWriteIn ? null : normalizeParty(FL_PARTY[c.partyCode ?? ""] ?? c.partyCode),
        sourceUrl,
      });
    }
    byRace.set(mapped.raceKey, race);
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
    basis: "CERTIFIED",
    rosters,
    candidateCount: rosters.reduce((n, r) => n + r.entries.length, 0),
    offices,
    unmapped: [...unmapped.entries()].map(([office, count]) => ({ office, count })).sort((a, b) => b.count - a.count),
  };
}

export async function fetchFlRoster(observedAt: Date, fetchImpl: typeof fetch = fetch): Promise<FlRosterRun> {
  const body = new URLSearchParams({ elecID: FL_GENERAL_2026, office: "All", status: "All", cantype: "STA", FormSubmit: "Download Candidate List" });
  const res = await fetchImpl(FL_EXTRACT, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
  if (!res.ok) throw new Error(`Florida extract returned ${res.status}`);
  const rows = parseExtract(await res.text());
  if (rows.length < 100) throw new Error(`Florida extract parsed to ${rows.length} rows; the form or file layout changed`);
  return toRosters(rows, `${FL_EXTRACT}?elecID=${FL_GENERAL_2026}`, observedAt);
}
