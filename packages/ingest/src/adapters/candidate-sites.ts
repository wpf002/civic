/**
 * Finding a candidate's campaign website.
 *
 * Without a website there is nothing to extract from, so this is the step between a
 * real roster and a real position. It uses only sources where the URL is stated by
 * the candidate or by a government record — never a search result, because "the top
 * hit for this name" is how one candidate's words end up attributed to another.
 *
 * Three sources, in descending order of how directly the candidate asserted it:
 *
 *   FEC Form 1     the campaign's own committee filing names its website. Self-
 *                  reported to the government under penalty of perjury, and
 *                  available for roughly half of Texas federal filers.
 *   OpenStates     campaign and official links for sitting state legislators.
 *   Congress.gov   the official .house.gov / .senate.gov site of a sitting member.
 *                  A government site, not campaign speech — franked content is
 *                  constrained differently — so it is tiered lower and labelled.
 *
 * A candidate with no website found is left with none. An empty websiteUrl is a true
 * statement; a guessed one is a liability.
 */

export type SiteKind = "CAMPAIGN" | "OFFICIAL";

export interface CandidateSite {
  url: string;
  kind: SiteKind;
  /** Which record asserted this URL, for the provenance line. */
  assertedBy: string;
  assertedByUrl: string;
}

/**
 * Normalize a URL as filed.
 *
 * Committee filings are typed by hand into a form: they arrive shouted, sometimes
 * without a scheme, sometimes with a trailing slash, occasionally as a bare domain.
 * Everything here is reversible formatting — no host is inferred and no path is
 * invented. Anything that does not look like a hostname is rejected rather than
 * repaired, because a repaired URL that resolves to the wrong site is worse than none.
 */
export function normalizeFiledUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  // Reject the things people type into a website field that are not websites.
  if (s.includes("@") && !s.startsWith("http")) return null;
  if (/^(n\/?a|none|tbd|pending|same)$/.test(s)) return null;

  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  // A hostname with no dot is not a public site. Neither is a bare IP.
  if (!u.hostname.includes(".")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return null;
  u.hash = "";
  if (u.pathname === "/") u.pathname = "";
  return u.toString().replace(/\/$/, "");
}

interface FecCommittee {
  designation?: string | null;
  website?: string | null;
  committee_id?: string;
  name?: string | null;
}

/**
 * The website a candidate's principal campaign committee filed.
 *
 * Only the principal committee (designation "P"). A joint fundraising or leadership
 * committee can carry a URL belonging to a different organisation entirely.
 */
export function siteFromFecCommittees(
  committees: FecCommittee[],
  candidateId: string,
): CandidateSite | null {
  for (const c of committees) {
    if (c.designation !== "P") continue;
    const url = normalizeFiledUrl(c.website);
    if (!url) continue;
    return {
      url,
      kind: "CAMPAIGN",
      assertedBy: `FEC Form 1, ${c.name ?? c.committee_id ?? "principal committee"}`,
      assertedByUrl: `https://www.fec.gov/data/candidate/${candidateId}/`,
    };
  }
  return null;
}

/** Hosts that are never a candidate's own site, however a record lists them. */
const NOT_A_CANDIDATE_SITE = [
  "ballotpedia.org",
  "wikipedia.org",
  "votesmart.org",
  "linkedin.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "youtube.com",
  "actblue.com",
  "winred.com",
];

const isGovernment = (host: string) =>
  host.endsWith(".gov") || host.endsWith(".us") || host.includes("house.texas.gov");

/**
 * Pick a site from OpenStates' link list.
 *
 * OpenStates mixes a legislator's campaign site with their chamber page, Ballotpedia,
 * Wikipedia, VoteSmart and LinkedIn. Only the first two are usable and they are not
 * interchangeable: a chamber biography page is a government record about a person,
 * not a statement of what they would do.
 */
export function siteFromOpenStatesLinks(
  links: Array<{ url: string; note?: string }>,
  personUrl: string,
): CandidateSite | null {
  const candidates = links
    .map((l) => normalizeFiledUrl(l.url))
    .filter((u): u is string => !!u)
    .filter((u) => {
      const host = new URL(u).hostname.replace(/^www\./, "");
      return !NOT_A_CANDIDATE_SITE.some((bad) => host === bad || host.endsWith(`.${bad}`));
    });

  const campaign = candidates.find((u) => !isGovernment(new URL(u).hostname));
  if (campaign) {
    return {
      url: campaign,
      kind: "CAMPAIGN",
      assertedBy: "OpenStates person record",
      assertedByUrl: personUrl,
    };
  }
  const official = candidates[0];
  if (!official) return null;
  return {
    url: official,
    kind: "OFFICIAL",
    assertedBy: "OpenStates person record",
    assertedByUrl: personUrl,
  };
}

/** A sitting member's official site. Government speech, tiered and labelled as such. */
export function siteFromCongressMember(
  member: { officialWebsiteUrl?: string | null; bioguideId?: string },
): CandidateSite | null {
  const url = normalizeFiledUrl(member.officialWebsiteUrl);
  if (!url) return null;
  return {
    url,
    kind: "OFFICIAL",
    assertedBy: "Congress.gov member record",
    assertedByUrl: `https://www.congress.gov/member/${member.bioguideId ?? ""}`,
  };
}

/**
 * Fetch principal-committee websites for a list of FEC candidate ids.
 *
 * One request per candidate: the bulk /committees/ endpoint omits the website field
 * entirely, which is not documented anywhere and is only visible by comparing the two
 * responses. Concurrency is capped low on purpose — the point is to be a good citizen
 * of a free public API, not to finish two minutes sooner.
 */
export interface SiteLookup {
  sites: Map<string, CandidateSite>;
  /**
   * Candidates whose committees could not be fetched at all.
   *
   * Kept apart from "has no website" on purpose. Folding them together is what made
   * a first run report 52 of 245 when the true rate was near half: rate-limited
   * requests were being counted as candidates without a site, and a coverage number
   * that quietly includes your own failures is worse than no number.
   */
  failed: string[];
}

export async function fetchFecSites(
  candidateIds: string[],
  opts: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    concurrency?: number;
    retries?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<SiteLookup> {
  const apiKey = opts.apiKey ?? process.env.FEC_API_KEY;
  if (!apiKey) throw new Error("FEC_API_KEY is not set. Get one at https://api.data.gov/signup/");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const limit = opts.concurrency ?? 4;
  const retries = opts.retries ?? 4;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const sites = new Map<string, CandidateSite>();
  const failed: string[] = [];
  const queue = [...candidateIds];

  const worker = async () => {
    for (;;) {
      const id = queue.shift();
      if (!id) return;

      let ok = false;
      for (let attempt = 0; attempt <= retries; attempt++) {
        let res: Response;
        try {
          res = await fetchImpl(
            `https://api.open.fec.gov/v1/candidate/${id}/committees/?api_key=${encodeURIComponent(apiKey)}`,
          );
        } catch {
          await sleep(250 * 2 ** attempt);
          continue;
        }
        // 429 is the rate limiter, not an answer about this candidate. Back off.
        if (res.status === 429 || res.status >= 500) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        if (!res.ok) {
          // A real 4xx is an answer: this candidate has no committee record. Not a
          // failure to look, which is a different thing and counted separately.
          ok = true;
          break;
        }
        const body = (await res.json()) as { results?: FecCommittee[] };
        const site = siteFromFecCommittees(body.results ?? [], id);
        if (site) sites.set(id, site);
        ok = true;
        break;
      }
      if (!ok) failed.push(id);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  return { sites, failed };
}

// ---------------------------------------------------------------- OpenStates

export interface OpenStatesPerson {
  id: string;
  name: string;
  party?: string;
  email?: string | null;
  openstates_url: string;
  current_role?: {
    title?: string;
    org_classification?: string;
    district?: string;
    division_id?: string;
  } | null;
  links?: Array<{ url: string; note?: string }>;
}

/**
 * Every sitting Texas state legislator, with their links.
 *
 * OpenStates knows OFFICEHOLDERS, not candidates — there is no candidate endpoint —
 * so this identifies incumbents and supplies their sites. It cannot tell you who is
 * running against them, and nothing here should be read as a 2026 state roster.
 */
export async function fetchOpenStatesPeople(
  jurisdiction = "Texas",
  opts: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<OpenStatesPerson[]> {
  const apiKey = opts.apiKey ?? process.env.OPENSTATES_API_KEY;
  if (!apiKey) {
    throw new Error("OPENSTATES_API_KEY is not set. Request one at https://open.pluralpolicy.com/accounts/profile/");
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const out: OpenStatesPerson[] = [];
  let page = 1;
  let maxPage = 1;

  do {
    const url =
      `https://v3.openstates.org/people?jurisdiction=${encodeURIComponent(jurisdiction)}` +
      `&per_page=50&page=${page}&include=links`;
    const res = await fetchImpl(url, { headers: { "X-API-KEY": apiKey } });
    if (!res.ok) throw new Error(`OpenStates returned ${res.status} on page ${page}`);
    const body = (await res.json()) as {
      results?: OpenStatesPerson[];
      pagination?: { max_page: number; total_items: number };
    };
    if (!Array.isArray(body.results)) throw new Error(`OpenStates page ${page} had no results`);
    out.push(...body.results);
    maxPage = body.pagination?.max_page ?? 1;
    page++;
  } while (page <= maxPage);

  return out;
}

// ---------------------------------------------------------------- Congress.gov

export interface CongressMember {
  bioguideId: string;
  name: string;
  district?: number | null;
  partyName?: string;
  terms?: { item?: Array<{ chamber?: string; startYear?: number; endYear?: number }> };
}

/** Sitting members of Congress for one state, from the current Congress. */
export async function fetchCongressMembers(
  state = "TX",
  congress = 119,
  opts: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<CongressMember[]> {
  const apiKey = opts.apiKey ?? process.env.CONGRESS_GOV_API_KEY;
  if (!apiKey) {
    throw new Error("CONGRESS_GOV_API_KEY is not set. Get one at https://api.congress.gov/sign-up/");
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const out: CongressMember[] = [];
  let offset = 0;

  for (;;) {
    const url =
      `https://api.congress.gov/v3/member/congress/${congress}/${state}` +
      `?api_key=${encodeURIComponent(apiKey)}&format=json&limit=250&offset=${offset}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Congress.gov returned ${res.status}`);
    const body = (await res.json()) as { members?: CongressMember[] };
    const batch = body.members ?? [];
    out.push(...batch);
    if (batch.length < 250) break;
    offset += 250;
  }
  return out;
}

/** The member detail call, which is the only place officialWebsiteUrl lives. */
export async function fetchCongressMemberSite(
  bioguideId: string,
  opts: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<CandidateSite | null> {
  const apiKey = opts.apiKey ?? process.env.CONGRESS_GOV_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_GOV_API_KEY is not set.");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(
    `https://api.congress.gov/v3/member/${bioguideId}?api_key=${encodeURIComponent(apiKey)}&format=json`,
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { member?: { officialWebsiteUrl?: string | null } };
  return siteFromCongressMember({ ...(body.member ?? {}), bioguideId });
}

/**
 * Choose between sites found for the same person.
 *
 * A campaign site always wins over an official one. A .gov page is bound by franking
 * rules and is a statement of what an officeholder has done in office; a campaign
 * site is a statement of what a candidate intends to do. For an issue-first guide
 * those are different claims and the second is the one being asked about.
 */
export function preferSite(a: CandidateSite | null, b: CandidateSite | null): CandidateSite | null {
  if (!a) return b;
  if (!b) return a;
  if (a.kind === b.kind) return a;
  return a.kind === "CAMPAIGN" ? a : b;
}
