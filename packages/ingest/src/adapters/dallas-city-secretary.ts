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
import { nameKey, type RosterEntry } from "../roster.js";

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
