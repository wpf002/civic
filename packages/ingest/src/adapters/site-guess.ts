/**
 * Finding a campaign website by trying likely domains and then proving it.
 *
 * The last resort, and only for candidates no record names a site for. 37 of 98
 * certified Texas candidates have none: 25 never filed an FEC committee, which is
 * where a campaign's own address comes from, and the state file carries no website
 * field. Party nominee lists were checked and carry no links either.
 *
 * WHY GUESSING IS SAFE HERE AND A SEARCH RESULT IS NOT. Nothing is accepted because
 * of how the URL was found. A candidate domain is accepted only when the page itself
 * says who it belongs to: the candidate's surname AND their office or state must
 * appear in the fetched text, and known aggregators and parked pages are refused
 * outright. A guessed URL that fails the proof is discarded, which is the same
 * outcome as never guessing it. "The top hit for this name" has no such proof, which
 * is why it stays out.
 *
 * This produces false negatives freely and false positives only if a page actively
 * impersonates a candidate for their own office.
 */
export interface GuessOptions {
  fullName: string;
  /** "TX", used to prove the page is about the right jurisdiction. */
  state: string;
  /** e.g. "United States Representative". */
  office: string;
  year?: number;
}

const STOP = new Set(["jr", "sr", "ii", "iii", "iv", "dr", "mr", "mrs", "ms"]);

/** Name parts, lowercased, punctuation removed, honorifics and suffixes dropped. */
export function nameParts(fullName: string): { first: string; last: string } {
  const tokens = fullName
    .toLowerCase()
    .replace(/["'’.,]/g, "")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
  return { first: tokens[0] ?? "", last: tokens[tokens.length - 1] ?? "" };
}

/**
 * Domains a campaign plausibly registered.
 *
 * Ordered most to least likely so a match is usually found in the first few and the
 * rest are never fetched.
 */
export function candidateDomains(opts: GuessOptions): string[] {
  const { first, last } = nameParts(opts.fullName);
  if (!first || !last) return [];
  const year = opts.year ?? 2026;
  const office = /senat/i.test(opts.office) ? "senate" : "congress";

  const stems = [
    `${first}${last}`,
    `${last}for${office}`,
    `${first}for${office}`,
    `${first}${last}for${office}`,
    `${first}${last}${year}`,
    `vote${last}`,
    `${last}${year}`,
    `${first}for${opts.state.toLowerCase()}`,
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const stem of stems) {
    for (const tld of [".com", ".org"]) {
      const d = `${stem}${tld}`;
      if (seen.has(d)) continue;
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

/** Hosts that are never a candidate's own site, however well the name matches. */
const NEVER = [
  "ballotpedia.org",
  "wikipedia.org",
  "votesmart.org",
  "linkedin.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "actblue.com",
  "winred.com",
  "fec.gov",
  "sos.state.tx.us",
  "godaddy.com",
  "sedo.com",
  "hugedomains.com",
  "afternic.com",
];

/** Copy a parked or for-sale domain shows instead of a campaign. */
const PARKED =
  /(this domain (is|may be) for sale|buy this domain|domain( name)? for sale|parked (free )?courtesy|related searches|under construction|coming soon)/i;

export interface Proof {
  accepted: boolean;
  why: string;
}

/**
 * Decide whether a fetched page proves it belongs to this candidate.
 *
 * Both halves are required. The surname alone matches a namesake; the office alone
 * matches any political site. Together they say this page is about this person
 * running for this office.
 */
export function provesCandidate(text: string, html: string, opts: GuessOptions): Proof {
  const { first, last } = nameParts(opts.fullName);
  const body = text.toLowerCase();

  if (body.length < 200) return { accepted: false, why: "page has almost no text" };
  if (PARKED.test(text)) return { accepted: false, why: "parked or for-sale domain" };

  const hasLast = body.includes(last);
  const hasFirst = body.includes(first);
  if (!hasLast || !hasFirst) {
    return { accepted: false, why: `page does not name ${opts.fullName}` };
  }

  const office = /senat/i.test(opts.office) ? "senate" : "congress";
  const jurisdiction =
    body.includes(office) ||
    body.includes("district") ||
    body.includes("house of representatives") ||
    body.includes(opts.state.toLowerCase() === "tx" ? "texas" : opts.state.toLowerCase());

  if (!jurisdiction) {
    return { accepted: false, why: "page names the person but nothing about the office" };
  }

  // A campaign page says so. Without this a personal or business site with the right
  // name and a mention of Texas would pass.
  const campaigning =
    /\b(campaign|for congress|for senate|elect|vote for|ballot|running for|paid for by)\b/i.test(text);
  if (!campaigning) {
    return { accepted: false, why: "page names the person and the place but is not a campaign" };
  }

  void hasFirst;
  return { accepted: true, why: "page names the candidate, the office, and is a campaign site" };
}

export const isNeverACandidateSite = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return NEVER.some((bad) => host === bad || host.endsWith(`.${bad}`));
  } catch {
    return true;
  }
};
