/**
 * Dallas City Council and Mayor rosters — 15 of the pilot's ~20 contests.
 *
 * Two sources, and they disagree, which is the whole point of this adapter:
 *
 *   /pdf/Elections/<year>/APPS/   — one scanned PDF per FILED application. The
 *                                   filename carries place and name; the PDF itself
 *                                   is an image and is never parsed.
 *   /pdf/Elections/<year>/BallotOrder.pdf — the CERTIFIED field with ballot order.
 *
 * In 2025 those two disagreed in both directions: people filed and did not appear
 * on the ballot, names drifted in spelling between them (Sukhbri→Sukhbir Kaur,
 * Russouw→Rossouw), and four places printed a ballot line with no name on it. So
 * "filed" and "certified" are modelled as separate observations and the diff between
 * them is a first-class output, never a silent merge.
 *
 * `isCertified` is set only from BallotOrder.pdf. A filed-only person is displayed as
 * filed, never as on the ballot.
 *
 * Dallas council seats are PLACES (1–14 plus Place 15, the Mayor), not "Districts".
 */
import { nameKey, type Roster, type RosterEntry } from "../roster.js";

const ORIGIN = "https://citysecretary2.dallascityhall.com";
export const ELECTIONS_ROOT = `${ORIGIN}/pdf/Elections`;

/** Must appear before the listing is trusted. IIS serves this on every directory. */
export const LISTING_MARKER = "[To Parent Directory]";

export interface ListedFile {
  name: string;
  href: string;
  url: string;
  sizeBytes: number;
  /** The server's own mtime. Trustworthy only for files written after the 2017 migration. */
  modifiedAt: string;
}

/**
 * Parse an IIS directory listing. Uppercase `<A HREF>`, and the date/size columns
 * are the primary change signal — cheaper and more reliable than hashing.
 */
export function parseDirectoryListing(html: string, baseUrl = ORIGIN): ListedFile[] {
  const out: ListedFile[] = [];
  const re =
    /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+(\d+|&lt;dir&gt;|<dir>)\s*<A\s+HREF="([^"]+)">([^<]+)<\/A>/gi;
  for (const m of html.matchAll(re)) {
    const [, date, time, size, href, name] = m;
    if (/dir/i.test(size!)) continue;
    out.push({
      name: decodeURIComponent(name!.trim()),
      href: href!,
      url: href!.startsWith("http") ? href! : baseUrl + href!,
      sizeBytes: Number(size),
      modifiedAt: `${date} ${time!.replace(/\s+/g, " ")}`,
    });
  }
  return out;
}

export interface FiledApplication {
  place: string;
  name: string;
  url: string;
  filedAt: string;
  /** A resubmitted application: "03 - John Sims2.pdf". Same person, not a second one. */
  isResubmission: boolean;
}

/**
 * Derive the filed roster from APPS filenames.
 *
 * The PDFs behind these are scans — one extractable character from a 1.4 MB file —
 * so the filename is the only machine-readable content. That is a real limitation
 * and it is why filed names are treated as observations rather than as truth.
 */
export function parseFiledApplications(files: ListedFile[]): FiledApplication[] {
  const out: FiledApplication[] = [];
  for (const f of files) {
    const m = f.name.match(/^(\d{1,2})\s*-\s*(.+?)(\d*)\.pdf$/i);
    if (!m) continue;
    const name = m[2]!.replace(/\s+/g, " ").trim();
    if (!name) continue;
    out.push({
      place: String(Number(m[1])),
      name,
      url: f.url,
      filedAt: f.modifiedAt,
      isResubmission: m[3] !== "",
    });
  }
  return out;
}

/** One person may file more than once. Collapse by normalized name within a place. */
export function dedupeFiled(apps: FiledApplication[]): FiledApplication[] {
  const seen = new Map<string, FiledApplication>();
  for (const a of apps) {
    const k = `${a.place}:${nameKey(a.name)}`;
    const prior = seen.get(k);
    // Keep the earliest filing, but prefer a name without the trailing resubmission digit.
    if (!prior || (prior.isResubmission && !a.isResubmission)) seen.set(k, a);
  }
  return [...seen.values()];
}

export interface CertifiedPlace {
  place: string;
  entries: RosterEntry[];
}

interface TextItem {
  s: string;
  x: number;
  y: number;
}

/**
 * Extract positioned text from a PDF. Coordinates matter: the ballot order is a
 * two-column layout, and a reading-order extraction interleaves Place 1 with
 * Place 8. Grouping by x-column and sorting by descending y is what keeps the
 * places intact.
 */
export async function extractPdfItems(data: Uint8Array): Promise<TextItem[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const items: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items as Array<{ str: string; transform: number[] }>) {
      if (!it.str.trim()) continue;
      items.push({
        s: it.str.replace(/\s+/g, " ").trim(),
        x: Math.round(it.transform[4]!),
        // Offset by page so multi-page orders stay in order.
        y: Math.round(it.transform[5]!) - (p - 1) * 10_000,
      });
    }
  }
  return items;
}

/**
 * Parse the certified ballot order.
 *
 * A line is either "Place N", a numbered entry "3 Zarin D. Gracey", or an UNNUMBERED
 * "Write-In Candidate" — and in 2025, Place 15 printed a bare "1" with no name at
 * all. Both of those become placeholder entries: an unnamed line on a ballot is a
 * missing candidate, and it blocks publication of that race rather than passing as
 * an absence nobody notices.
 */
/** Group items onto shared baselines (±2pt) and join them left to right. */
function mergeRows(items: TextItem[], tolerance = 2): TextItem[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextItem[][] = [];
  for (const it of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0]!.y - it.y) <= tolerance) row.push(it);
    else rows.push([it]);
  }
  return rows.map((r) => {
    const ordered = r.sort((a, b) => a.x - b.x);
    return { s: ordered.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim(), x: ordered[0]!.x, y: ordered[0]!.y };
  });
}

export function parseBallotOrder(items: TextItem[]): CertifiedPlace[] {
  const columnOf = (x: number) => (x < 250 ? 0 : 1);
  const byColumn: TextItem[][] = [[], []];
  for (const it of items) byColumn[columnOf(it.x)]!.push(it);

  const places: CertifiedPlace[] = [];
  for (const col of byColumn) {
    // The ballot number and the name are separate text items on the same baseline
    // ("5" at x=105, "Laura Cadena" at x=116). Rows must be merged before parsing or
    // every multi-entry place reads as a column of unnamed lines. But a place heading
    // shares its baseline with that place's FIRST entry, so a merged row can carry
    // both — "Place 6 1 David Blewett" — and the heading has to be split back off.
    let current: CertifiedPlace | null = null;

    for (const row of mergeRows(col)) {
      let rest = row.s;

      const heading = rest.match(/^Place\s+(\d{1,2})\b\s*/i);
      if (heading) {
        current = { place: heading[1]!, entries: [] };
        places.push(current);
        rest = rest.slice(heading[0].length).trim();
        if (!rest) continue;
      }
      if (!current) continue;

      addEntry(current, rest);
    }
  }
  return places.sort((a, b) => Number(a.place) - Number(b.place));
}

function addEntry(place: CertifiedPlace, text: string): void {
  // "Write-In Candidate" is printed without a ballot number.
  if (/^write[-\s]?in candidate$/i.test(text)) {
    place.entries.push({
      key: `placeholder-write-in-${place.place}-${place.entries.length}`,
      name: "Write-In Candidate",
      isWriteIn: true,
      isPlaceholder: true,
    });
    return;
  }

  const numbered = text.match(/^(\d{1,2})\s*(.*)$/);
  if (!numbered) return;
  const order = Number(numbered[1]);
  const name = (numbered[2] ?? "").trim();

  if (!name) {
    // A numbered ballot line with no name. 2025 Place 15 printed exactly this, and
    // an unnamed candidate on a ballot is a missing candidate.
    place.entries.push({
      key: `placeholder-unnamed-${place.place}-${order}`,
      name: "(unnamed ballot line)",
      ballotOrder: order,
      isPlaceholder: true,
    });
    return;
  }

  if (/^write[-\s]?in candidate$/i.test(name)) {
    place.entries.push({
      key: `placeholder-write-in-${place.place}-${order}`,
      name: "Write-In Candidate",
      ballotOrder: order,
      isWriteIn: true,
      isPlaceholder: true,
    });
    return;
  }

  place.entries.push({ key: nameKey(name), name, ballotOrder: order });
}

export interface FiledVsCertified {
  place: string;
  /** Filed but not on the certified ballot. Displayed as filed, never as on the ballot. */
  filedOnly: string[];
  /** On the ballot with no matching filing. Always a review task. */
  certifiedOnly: string[];
  /** Same person, two spellings. Proposed, never confirmed automatically. */
  probableRespellings: Array<{ filed: string; certified: string }>;
  placeholders: number;
}

/**
 * The reconciliation. Its own output, not a side effect of parsing — in 2025 it
 * would have surfaced four filed-but-not-on-ballot people and several name drifts.
 */
export function reconcile(
  filed: FiledApplication[],
  certified: CertifiedPlace[],
): FiledVsCertified[] {
  const out: FiledVsCertified[] = [];
  const places = new Set([...filed.map((f) => f.place), ...certified.map((c) => c.place)]);

  for (const place of [...places].sort((a, b) => Number(a) - Number(b))) {
    const f = filed.filter((x) => x.place === place);
    const c = certified.find((x) => x.place === place)?.entries ?? [];
    const cReal = c.filter((e) => !e.isPlaceholder);

    const fKeys = new Map(f.map((x) => [nameKey(x.name), x.name]));
    const cKeys = new Map(cReal.map((x) => [x.key, x.name]));

    const filedOnly = [...fKeys].filter(([k]) => !cKeys.has(k));
    const certifiedOnly = [...cKeys].filter(([k]) => !fKeys.has(k));

    const probableRespellings: FiledVsCertified["probableRespellings"] = [];
    for (const [, fn] of filedOnly) {
      for (const [, cn] of certifiedOnly) {
        if (looksLikeSamePerson(fn, cn)) probableRespellings.push({ filed: fn, certified: cn });
      }
    }

    out.push({
      place,
      filedOnly: filedOnly.map(([, n]) => n),
      certifiedOnly: certifiedOnly.map(([, n]) => n),
      probableRespellings,
      placeholders: c.length - cReal.length,
    });
  }
  return out;
}

/** Proposes a pair. Never confirms one — a human decides. */
function looksLikeSamePerson(a: string, b: string): boolean {
  const [x, y] = [nameKey(a), nameKey(b)];
  if (x === y) return true;
  const first = (s: string) => s.split(" ")[0] ?? "";
  const last = (s: string) => s.split(" ").filter(Boolean).at(-1) ?? "";
  const near = (p: string, q: string) =>
    p === q || (p.length > 3 && q.length > 3 && editDistanceAtMost(p, q, 2));
  return (near(last(x), last(y)) && near(first(x), first(y))) || (last(x) === last(y) && x !== y);
}

function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]! <= max;
}

export const yearUrl = (year: number) => `${ELECTIONS_ROOT}/${year}/`;
export const appsUrl = (year: number) => `${ELECTIONS_ROOT}/${year}/APPS/`;
export const ballotOrderUrl = (year: number) => `${ELECTIONS_ROOT}/${year}/BallotOrder.pdf`;

// ---------------------------------------------------------------- persistence

/**
 * Ballot "Place N" → race key.
 *
 * "Place" is NOT treated as a synonym for "District". Both terms are genuinely in
 * use for the same seats — the certified ballot prints "Place 7", the GIS layer
 * returns DISTRICT 7, and the two are not guaranteed to line up for every seat in
 * every cycle (Place 15 carries the at-large mayoralty, which has no district at
 * all). Nothing in this file converts one into the other.
 *
 * The mapping lives in the database as `Office.seatLabel`, entered by a person. A
 * Place with no matching seatLabel resolves to nothing and quarantines, which is
 * the correct outcome: a roster attached to the wrong race is worse than a roster
 * that waits for someone to say which race it belongs to.
 */
export const placeRaceKey = (place: string): string => `dallas-council-place-${Number(place)}`;

/** The seatLabel a Place must match, verbatim. */
export const placeSeatLabel = (place: string): string => `Place ${Number(place)}`;

/** Which document a roster was read off. Filed and certified are never unioned. */
export type RosterBasis = "FILED" | "CERTIFIED";

/**
 * Build rosters from the certified ballot order.
 *
 * Placeholder lines are carried through, not dropped. An unnamed line on a ballot
 * means the parse is short a person, and `diffRoster` quarantines on placeholders
 * so that race waits for a human instead of publishing a roster missing someone.
 */
export function certifiedRosters(
  places: CertifiedPlace[],
  sourceUrl: string,
  observedAt: Date,
): Roster[] {
  return places.map((p) => ({
    raceKey: placeRaceKey(p.place),
    entries: p.entries.map((e) => ({ ...e, sourceUrl })),
    sourceUrl,
    observedAt,
  }));
}

/**
 * Build rosters from the filed applications.
 *
 * Used only before certification, when BallotOrder.pdf does not exist yet. These
 * names come from PDF filenames — see `parseFiledApplications` — so they carry no
 * ballot order and are never marked certified downstream.
 */
export function filedRosters(
  filed: FiledApplication[],
  sourceUrl: string,
  observedAt: Date,
): Roster[] {
  const byPlace = new Map<string, FiledApplication[]>();
  for (const f of filed) {
    const list = byPlace.get(f.place) ?? [];
    list.push(f);
    byPlace.set(f.place, list);
  }
  return [...byPlace.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([place, apps]) => ({
      raceKey: placeRaceKey(place),
      entries: apps.map((a) => ({ key: nameKey(a.name), name: a.name, sourceUrl: a.url })),
      sourceUrl,
      observedAt,
    }));
}

export interface CouncilRosterRun {
  basis: RosterBasis;
  rosters: Roster[];
  filed: FiledApplication[];
  certified: CertifiedPlace[];
  /** Filed-vs-certified differences. Surfaced, never merged away. */
  reconciliation: FiledVsCertified[];
  sourceUrl: string;
}

/** Transport only. The checks that make a response trustworthy are in the caller. */
async function fetchListing(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

/** Transport only. `null` means 404 — not certified yet, which is a real state. */
async function fetchPdf(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, { redirect: "follow" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Assert a directory listing is the listing.
 *
 * Deliberately NOT inside `fetchListing`: a check that lives in an injectable
 * dependency is a check a test double removes, and then the guard exists only on
 * the path nobody exercises. It runs on whatever HTML arrives, however it arrived.
 */
function assertListing(html: string, url: string): void {
  if (!html.includes(LISTING_MARKER)) {
    throw new Error(
      `${url} did not contain "${LISTING_MARKER}". A 200 is not evidence that a page is ` +
        `the page — treating this as a failed fetch rather than as an empty directory.`,
    );
  }
}

/** Same reasoning. An HTML error page parses as a PDF with zero places on it. */
function assertPdf(bytes: Uint8Array, url: string): void {
  const magic = String.fromCharCode(...bytes.slice(0, 5));
  if (magic !== "%PDF-") {
    throw new Error(`${url} is not a PDF (starts with ${JSON.stringify(magic)})`);
  }
}

/**
 * Fetch one cycle's council roster.
 *
 * Prefers the certified ballot when it exists. Before certification the filed
 * applications are the roster; after it, they are only a cross-check, because in
 * 2025 four people filed and did not appear on the ballot.
 */
export async function fetchCouncilRoster(
  year: number,
  observedAt: Date,
  deps: {
    fetchListingImpl?: (url: string) => Promise<string>;
    fetchPdfImpl?: (url: string) => Promise<Uint8Array | null>;
  } = {},
): Promise<CouncilRosterRun> {
  const getListing = deps.fetchListingImpl ?? fetchListing;
  const getPdf = deps.fetchPdfImpl ?? fetchPdf;

  const appsHtml = await getListing(appsUrl(year));
  assertListing(appsHtml, appsUrl(year));
  const filed = dedupeFiled(parseFiledApplications(parseDirectoryListing(appsHtml)));

  const pdf = await getPdf(ballotOrderUrl(year));
  if (pdf) assertPdf(pdf, ballotOrderUrl(year));
  const certified = pdf ? parseBallotOrder(await extractPdfItems(pdf)) : [];

  const basis: RosterBasis = certified.length > 0 ? "CERTIFIED" : "FILED";
  const sourceUrl = basis === "CERTIFIED" ? ballotOrderUrl(year) : appsUrl(year);

  return {
    basis,
    sourceUrl,
    filed,
    certified,
    reconciliation: reconcile(filed, certified),
    rosters:
      basis === "CERTIFIED"
        ? certifiedRosters(certified, sourceUrl, observedAt)
        : filedRosters(filed, sourceUrl, observedAt),
  };
}
