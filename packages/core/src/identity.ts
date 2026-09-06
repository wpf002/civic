/**
 * Deciding whether two candidate records describe the same person.
 *
 * This exists because the same person is spelled differently by different
 * authorities. The FEC has "GARCIA, SYLVIA R" and the Texas Secretary of State has
 * "SYLVIA GARCIA"; the FEC has "Steven James Shook" and the ballot says "Steven
 * Shook". Left alone, one person holds two rows, and the row that carries their
 * website is not the row that appears on the ballot.
 *
 * Nothing in this file merges anything. It proposes, with a stated reason and a
 * confidence, and a person decides. Merging two records is a removal — one of them
 * stops existing — and this codebase does not remove a candidate without a human and
 * a document. Two people really can share a name in one race, and the cost of being
 * wrong is that a real candidate silently vanishes.
 *
 * Deterministic and I/O-free, like the matcher and the calendar.
 */

/** Generational suffixes carry meaning: Jr and Sr in one race are two people. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "vi"]);

const STRIP = /[.,'’"()]/g;

export interface NameParts {
  first: string;
  middles: string[];
  last: string;
  suffix: string | null;
}

/**
 * Split a display name into parts.
 *
 * Expects "First Middle Last Suffix" order — both sources are normalized to that
 * before they reach here, so this does not try to detect a reversed name.
 */
export function parseName(name: string): NameParts {
  const tokens = name
    .toLowerCase()
    .replace(STRIP, "")
    .split(/\s+/)
    .filter(Boolean);

  let suffix: string | null = null;
  if (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1]!)) {
    suffix = tokens.pop()!;
  }
  const last = tokens.pop() ?? "";
  const first = tokens.shift() ?? "";
  return { first, middles: tokens, last, suffix };
}

/** A middle initial matches a middle name: "Sylvia R Garcia" and "Sylvia Garcia". */
function middlesCompatible(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true; // one source simply omitted them
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((s, i) => {
    const l = long[i];
    if (!l) return false;
    return s === l || (s.length === 1 && l.startsWith(s)) || (l.length === 1 && s.startsWith(l));
  });
}

/** "Bill" for "William". Only pairs that are unambiguous in practice. */
const NICKNAMES: Array<[string, string]> = [
  ["william", "bill"], ["william", "will"], ["robert", "bob"], ["robert", "rob"],
  ["richard", "rick"], ["richard", "dick"], ["james", "jim"], ["james", "jamie"],
  ["joseph", "joe"], ["michael", "mike"], ["thomas", "tom"], ["charles", "charlie"],
  ["charles", "chuck"], ["daniel", "dan"], ["daniel", "danny"], ["david", "dave"],
  ["christopher", "chris"], ["matthew", "matt"], ["anthony", "tony"], ["steven", "steve"],
  ["stephen", "steve"], ["edward", "ed"], ["kenneth", "ken"], ["jeffrey", "jeff"],
  ["gregory", "greg"], ["nicholas", "nick"], ["benjamin", "ben"], ["samuel", "sam"],
  ["patricia", "pat"], ["elizabeth", "liz"], ["elizabeth", "beth"], ["margaret", "peggy"],
  ["katherine", "kathy"], ["catherine", "cathy"], ["deborah", "debbie"], ["jennifer", "jen"],
  ["susan", "sue"], ["barbara", "barb"], ["rebecca", "becky"], ["theodore", "ted"],
];

function firstNamesMatch(a: string, b: string): { match: boolean; why: string } {
  if (!a || !b) return { match: false, why: "" };
  if (a === b) return { match: true, why: "same first name" };
  if (NICKNAMES.some(([full, nick]) => (a === full && b === nick) || (b === full && a === nick))) {
    return { match: true, why: "known nickname" };
  }
  // An initial against a name: "J Smith" and "James Smith".
  if ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))) {
    return { match: true, why: "first initial" };
  }
  return { match: false, why: "" };
}

export type MatchConfidence = "strong" | "possible";

export interface IdentityProposal {
  confidence: MatchConfidence;
  reason: string;
}

/**
 * Compare two names that appear in the SAME race.
 *
 * Same-race is the caller's job and it is what makes this usable at all: two Sylvia
 * Garcias on one ballot is vanishingly unlikely, while two in Texas is certain.
 *
 * Returns null when the names should be treated as different people. A differing
 * generational suffix is always different people — Jr and Sr run against each other.
 */
export function proposeSamePerson(nameA: string, nameB: string): IdentityProposal | null {
  const a = parseName(nameA);
  const b = parseName(nameB);

  if (!a.last || !b.last) return null;
  if (a.last !== b.last) return null;

  // "Alfredo Hinojosa Jr." and "Gregory Kunkle Jr." share only a suffix. A naive
  // last-token comparison paired those two, which is why the suffix is split off
  // before the surname is read.
  if (a.suffix !== b.suffix) return null;

  const first = firstNamesMatch(a.first, b.first);
  if (!first.match) return null;
  if (!middlesCompatible(a.middles, b.middles)) return null;

  const exactFirst = a.first === b.first;
  const middlesDiffer = a.middles.join(" ") !== b.middles.join(" ");

  if (exactFirst && !middlesDiffer) {
    return { confidence: "strong", reason: "same first and last name, same race" };
  }
  if (exactFirst) {
    return { confidence: "strong", reason: `same first and last name; middle names differ only by omission or initial` };
  }
  return { confidence: "possible", reason: `surname matches and first names match by ${first.why}` };
}

export interface Identifiable {
  id: string;
  fullName: string;
}

export interface ProposedPair<T extends Identifiable> {
  a: T;
  b: T;
  confidence: MatchConfidence;
  reason: string;
}

/** Every proposed pair within one race. O(n^2) over a handful of names. */
export function proposePairsInRace<T extends Identifiable>(people: T[]): Array<ProposedPair<T>> {
  const out: Array<ProposedPair<T>> = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const p = proposeSamePerson(people[i]!.fullName, people[j]!.fullName);
      if (p) out.push({ a: people[i]!, b: people[j]!, confidence: p.confidence, reason: p.reason });
    }
  }
  return out;
}
