/**
 * Roll-call votes from Congress.gov.
 *
 * A vote is the strongest evidence this product can carry. A campaign website says
 * what someone intends; a recorded vote says what they did, it is published by the
 * institution rather than by the candidate, and there is nothing to paraphrase.
 *
 * This file does exactly one thing: record who voted which way. It draws no
 * conclusion about what a vote means. That interpretation — does a Yea on HR 5103
 * agree or disagree with a given proposition — is a separate, reviewable judgment
 * made ONCE PER BILL rather than once per candidate. One decision then covers all
 * 435 members, which is both cheaper and far easier to audit than 435 readings of
 * the same bill.
 *
 * Docs: https://api.congress.gov/
 */

const API = "https://api.congress.gov/v3";

export interface RollCall {
  congress: number;
  session: number;
  rollCallNumber: number;
  legislationType: string | null;
  legislationNumber: string | null;
  legislationUrl: string | null;
  result: string | null;
  startDate: string | null;
  /** The Clerk's own XML, which is the record of record. */
  sourceDataUrl: string | null;
}

export interface MemberVote {
  bioguideId: string;
  firstName: string | null;
  lastName: string | null;
  /** Yea | Nay | Present | Not Voting, as the Clerk records it. */
  voteCast: string;
  party: string | null;
  state: string | null;
}

/** `HR 5103` — stable across the API and the Clerk's site. */
export const billKey = (v: Pick<RollCall, "legislationType" | "legislationNumber">): string | null =>
  v.legislationType && v.legislationNumber ? `${v.legislationType} ${v.legislationNumber}` : null;

/** The public page for one roll call, which is what a citation should point at. */
export const rollCallUrl = (v: RollCall): string =>
  v.sourceDataUrl ??
  `https://clerk.house.gov/Votes/${new Date(v.startDate ?? Date.now()).getFullYear()}${String(v.rollCallNumber).padStart(3, "0")}`;

async function getJson(url: string, fetchImpl: typeof fetch, sleep: (ms: number) => Promise<void>) {
  for (let attempt = 0; attempt <= 4; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    // 429 is the rate limiter, not an answer about this vote.
    if (res.status === 429 || res.status >= 500) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Congress.gov returned ${res.status} for ${url.replace(/api_key=[^&]+/, "api_key=***")}`);
    return res.json();
  }
  throw new Error(`Congress.gov did not respond after retries`);
}

export function parseRollCalls(body: unknown): RollCall[] {
  const rows = (body as { houseRollCallVotes?: unknown[] })?.houseRollCallVotes;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const v = r as Record<string, unknown>;
    return {
      congress: Number(v.congress),
      session: Number(v.sessionNumber),
      rollCallNumber: Number(v.rollCallNumber),
      legislationType: (v.legislationType as string) ?? null,
      legislationNumber: (v.legislationNumber as string) ?? null,
      legislationUrl: (v.legislationUrl as string) ?? null,
      result: (v.result as string) ?? null,
      startDate: (v.startDate as string) ?? null,
      sourceDataUrl: (v.sourceDataURL as string) ?? null,
    };
  });
}

export function parseMemberVotes(body: unknown): MemberVote[] {
  const results = (body as { houseRollCallVoteMemberVotes?: { results?: unknown[] } })
    ?.houseRollCallVoteMemberVotes?.results;
  if (!Array.isArray(results)) return [];
  return results.map((r) => {
    const v = r as Record<string, unknown>;
    return {
      bioguideId: String(v.bioguideID ?? ""),
      firstName: (v.firstName as string) ?? null,
      lastName: (v.lastName as string) ?? null,
      voteCast: String(v.voteCast ?? ""),
      party: (v.voteParty as string) ?? null,
      state: (v.voteState as string) ?? null,
    };
  });
}

/** List roll calls for one session, newest first. */
export async function fetchRollCalls(
  congress: number,
  session: number,
  opts: { apiKey?: string; fetchImpl?: typeof fetch; limit?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RollCall[]> {
  const apiKey = opts.apiKey ?? process.env.CONGRESS_GOV_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_GOV_API_KEY is not set. Get one at https://api.congress.gov/sign-up/");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const out: RollCall[] = [];
  const want = opts.limit ?? 250;
  let offset = 0;

  while (out.length < want) {
    const body = await getJson(
      `${API}/house-vote/${congress}/${session}?api_key=${encodeURIComponent(apiKey)}&format=json&limit=250&offset=${offset}`,
      fetchImpl,
      sleep,
    );
    const batch = parseRollCalls(body);
    if (batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 250) break;
    offset += 250;
  }
  return out.slice(0, want);
}

/** How every member voted on one roll call. */
export async function fetchMemberVotes(
  congress: number,
  session: number,
  rollCallNumber: number,
  opts: { apiKey?: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<MemberVote[]> {
  const apiKey = opts.apiKey ?? process.env.CONGRESS_GOV_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_GOV_API_KEY is not set.");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const body = await getJson(
    `${API}/house-vote/${congress}/${session}/${rollCallNumber}/members?api_key=${encodeURIComponent(apiKey)}&format=json&limit=600`,
    fetchImpl,
    sleep,
  );
  const votes = parseMemberVotes(body);

  // The House has 435 seats. A handful of members are always absent, but a response
  // with a dozen rows is a truncated page, and a short vote list would read as
  // members who did not vote — which is a claim about them that we would be making up.
  if (votes.length > 0 && votes.length < 300) {
    throw new Error(
      `Roll call ${congress}-${session}-${rollCallNumber} returned only ${votes.length} member votes. ` +
        `A short list is indistinguishable from members not voting, so this is treated as a failed fetch.`,
    );
  }
  return votes;
}
