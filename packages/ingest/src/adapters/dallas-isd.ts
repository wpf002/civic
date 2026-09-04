/**
 * Dallas ISD trustee rosters — 5 of the pilot's ~20 contests.
 *
 * Free, keyless, no contract, no OCR. The district publishes candidates on an HTML
 * page as they file, and links the Orders of Cancellation and Certificates of
 * Withdrawal that justify a name leaving.
 *
 * Three things this adapter must never do, each learned from the live pages:
 *
 * 1. NEVER hardcode the candidates-page slug. It carries the election date
 *    ("may-2-2026-general-election-candidates") and rotates every cycle. It is
 *    discovered from the index, and the discovered date is checked against the
 *    Election row before a single name is parsed — otherwise a rotated slug means
 *    happily re-parsing last cycle's roster at HTTP 200.
 *
 * 2. NEVER trust the <title>. The May 2025 page still titled itself May 4 2024.
 *
 * 3. NEVER treat an empty parse as an empty field. The page for an election that
 *    has not opened filing yet looks exactly like a page whose parser broke.
 */
import { nameKey, normalizeForHash, type Roster, type RosterEntry } from "../roster.js";

export const INDEX_URL = "https://www.dallasisd.org/board-of-trustees/elections-information";
const ORIGIN = "https://www.dallasisd.org";

/** Must appear in the body before anything is parsed. A 200 is not evidence. */
export const INDEX_MARKER = "Election Information";
export const CANDIDATES_MARKER = "General Election Candidates";

export interface DiscoveredElectionPage {
  url: string;
  /** Parsed from the slug, not from the title. */
  electionDate: string; // ISO yyyy-mm-dd
  slug: string;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Find every "<month>-<day>-<year>-general-election-candidates" page linked from the
 * index, newest first. Returns all of them so a caller can select by date rather
 * than trusting ordering.
 */
export function discoverCandidatePages(indexHtml: string): DiscoveredElectionPage[] {
  const re =
    /href="([^"]*\/((january|february|march|april|may|june|july|august|september|october|november|december)-(\d{1,2})-(\d{4})-general-election-candidates))"/gi;
  const out = new Map<string, DiscoveredElectionPage>();
  for (const m of indexHtml.matchAll(re)) {
    const [, href, slug, month, day, year] = m;
    const mm = MONTHS[month!.toLowerCase()]!;
    const electionDate = `${year}-${String(mm).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
    const url = href!.startsWith("http") ? href! : ORIGIN + href!;
    out.set(url, { url, electionDate, slug: slug! });
  }
  return [...out.values()].sort((a, b) => b.electionDate.localeCompare(a.electionDate));
}

/** Documents that justify a name leaving a roster. Linked from the index, not the roster page. */
export interface RosterDocument {
  kind: "ORDER_OF_CANCELLATION" | "CERTIFICATE_OF_WITHDRAWAL" | "RESOLUTION_ORDERING" | "OTHER";
  district?: string;
  title: string;
  url: string;
}

export function discoverRosterDocuments(indexHtml: string): RosterDocument[] {
  const out: RosterDocument[] = [];
  for (const m of indexHtml.matchAll(/href="([^"]+)"[^>]*>([^<]{10,200})</g)) {
    const url = m[1]!.startsWith("http") ? m[1]! : ORIGIN + m[1]!;
    const title = decodeEntities(m[2]!).replace(/\s+/g, " ").trim();
    let kind: RosterDocument["kind"] | null = null;
    if (/order of cancellation/i.test(title)) kind = "ORDER_OF_CANCELLATION";
    else if (/certificate of withdrawal/i.test(title)) kind = "CERTIFICATE_OF_WITHDRAWAL";
    else if (/resolution ordering/i.test(title)) kind = "RESOLUTION_ORDERING";
    if (!kind) continue;
    const d = title.match(/district\s+(\d+)/i);
    out.push({ kind, title, url, ...(d ? { district: d[1]! } : {}) });
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function toText(html: string): string[] {
  const body = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  return decodeEntities(body.replace(/<[^>]+>/g, "\n"))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export interface ParsedRoster {
  /** Trustee district number as published, e.g. "2". */
  district: string;
  entries: RosterEntry[];
}

/**
 * Parse the candidates page into one roster per trustee district.
 *
 * The live shape is a "District N" heading followed by lines of
 * "<Name> - Candidate Application". Anything that does not match that shape is
 * ignored rather than guessed at.
 */
export function parseCandidatesPage(html: string, sourceUrl: string): ParsedRoster[] {
  const lines = toText(html);
  const rosters: ParsedRoster[] = [];
  let current: ParsedRoster | null = null;

  for (const line of lines) {
    const heading = line.match(/^District\s+(\d+)\s*$/i);
    if (heading) {
      current = { district: heading[1]!, entries: [] };
      rosters.push(current);
      continue;
    }
    if (!current) continue;

    // "Sarah Weinberg - Candidate Application"
    const cand = line.match(/^(.+?)\s*[-–—]\s*Candidate Application\s*$/i);
    if (!cand) {
      // A new non-candidate section ends the district block, so a footer link never
      // becomes a candidate.
      if (/^(Footer|Twitter|Facebook|YouTube|Instagram|Flickr|Campaign Finance)/i.test(line)) {
        current = null;
      }
      continue;
    }
    const name = cand[1]!.replace(/\s+/g, " ").trim();
    if (!name || name.length > 80) continue;
    current.entries.push({
      key: nameKey(name),
      name,
      sourceUrl,
      // A ballot line with no name is a placeholder that blocks publication.
      isPlaceholder: /^write[- ]?in candidate$/i.test(name),
      isWriteIn: /write[- ]?in/i.test(name),
    });
  }

  return rosters.filter((r) => r.entries.length > 0 || rosters.length === 1);
}

export interface FetchResult {
  html: string;
  normalizedHash: string;
  etag?: string;
  lastModified?: string;
}

async function sha256(s: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Fetch with conditional GET, marker assertion and token-stripped hashing.
 * Returns null when the server says 304.
 */
export async function fetchWatched(
  url: string,
  marker: string,
  prior?: { etag?: string; lastModified?: string },
): Promise<FetchResult | null> {
  const headers: Record<string, string> = {};
  if (prior?.etag) headers["if-none-match"] = prior.etag;
  if (prior?.lastModified) headers["if-modified-since"] = prior.lastModified;

  const res = await fetch(url, { headers, redirect: "follow" });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);

  const html = await res.text();
  if (!html.includes(marker)) {
    throw new Error(
      `${url} returned ${res.status} but does not contain the expected marker ${JSON.stringify(marker)}. ` +
        `Treating as a failed fetch — a status code is not evidence that a page is the page.`,
    );
  }

  const out: FetchResult = { html, normalizedHash: await sha256(normalizeForHash(html)) };
  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");
  if (etag) out.etag = etag;
  if (lastModified) out.lastModified = lastModified;
  return out;
}

export interface IsdRosterRun {
  page: DiscoveredElectionPage;
  rosters: Roster[];
  documents: RosterDocument[];
  sourceHash: string;
}

/**
 * Discover, verify the date, and parse. `expectElectionDate` is required: without
 * it a rotated slug silently yields the previous cycle's roster.
 */
export async function fetchIsdRoster(
  expectElectionDate: string,
  now: Date,
  fetchImpl = fetchWatched,
): Promise<IsdRosterRun> {
  const index = await fetchImpl(INDEX_URL, INDEX_MARKER);
  if (!index) throw new Error("index returned 304 with no prior state");

  const pages = discoverCandidatePages(index.html);
  const page = pages.find((p) => p.electionDate === expectElectionDate);
  if (!page) {
    throw new Error(
      `No candidates page for ${expectElectionDate} is linked from the index yet. ` +
        `Found: ${pages.map((p) => p.electionDate).join(", ") || "none"}. ` +
        `This is "not yet published", which is not the same as "no candidates".`,
    );
  }

  const candidates = await fetchImpl(page.url, CANDIDATES_MARKER);
  if (!candidates) throw new Error("candidates page returned 304 with no prior state");

  const parsed = parseCandidatesPage(candidates.html, page.url);
  return {
    page,
    documents: discoverRosterDocuments(index.html),
    sourceHash: candidates.normalizedHash,
    rosters: parsed.map((p) => ({
      raceKey: `disd-trustee-${p.district}`,
      entries: p.entries,
      sourceUrl: page.url,
      observedAt: now,
    })),
  };
}
