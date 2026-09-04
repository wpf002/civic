/**
 * Roster diffing and the shrink guard.
 *
 * A missing candidate is the one unrecoverable error in this product. Everything
 * here exists to make a roster that SHRINKS impossible to apply silently.
 *
 * The rule, stated once: a diff whose `removed` set is non-empty can never be
 * auto-applied. Not above a threshold, not below a percentage, not "probably a
 * parse blip" — never. A removal is accepted only when a human attaches the
 * artifact that justifies it (a Certificate of Withdrawal, an Order of
 * Cancellation, or a certified ballot that omits the name). There is no code path
 * that removes a candidate without a document.
 *
 * This is deliberately more conservative than it needs to be for the common case,
 * because the failure is asymmetric. Publishing a stale-but-reviewed roster costs a
 * day of freshness. Publishing a roster that quietly dropped someone disenfranchises
 * a candidate and there is no way to find out you did it.
 *
 * Deterministic and I/O-free, like the matcher and the calendar.
 */

export interface RosterEntry {
  /** Stable within a race. Normalized name is the only key a municipal source gives us. */
  key: string;
  name: string;
  /** The certified-ballot spelling when we have it; otherwise as filed. */
  displayName?: string;
  ballotOrder?: number;
  isWriteIn?: boolean;
  isPlaceholder?: boolean;
  sourceUrl?: string;
}

export interface Roster {
  raceKey: string;
  entries: RosterEntry[];
  sourceUrl: string;
  observedAt: Date;
}

export type DiffVerdict = "AUTO_APPLIED" | "QUARANTINED";

export interface RosterDiffResult {
  raceKey: string;
  added: RosterEntry[];
  removed: RosterEntry[];
  changed: Array<{ key: string; from: RosterEntry; to: RosterEntry }>;
  verdict: DiffVerdict;
  /** Why it was quarantined. Empty when auto-applied. */
  reasons: string[];
}

/**
 * Normalize a name to a comparison key.
 *
 * Municipal sources spell the same person differently between the filing list and
 * the certified ballot — the 2025 Dallas cycle produced Sukhbri/Sukhbir Kaur and
 * Russouw/Rossouw. This folds case, punctuation, accents and suffixes so those do
 * not read as one person leaving and another arriving. It does NOT attempt fuzzy
 * matching: near-miss pairs are surfaced for a human, never merged automatically.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/["'’.]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface DiffOptions {
  /**
   * A race whose previous roster was non-empty and whose new roster is empty is a
   * FETCH FAILURE, not a roster update. Set false only for a race genuinely
   * cancelled with an order attached.
   */
  treatEmptyAsFailure?: boolean;
  /** Certified field size. A parse yielding fewer than this is treated as a bad fetch. */
  expectedCount?: number;
}

export function diffRoster(
  previous: Roster | null,
  next: Roster,
  opts: DiffOptions = {},
): RosterDiffResult {
  const { treatEmptyAsFailure = true, expectedCount } = opts;

  const prevMap = new Map((previous?.entries ?? []).map((e) => [e.key, e]));
  const nextMap = new Map(next.entries.map((e) => [e.key, e]));

  const added = next.entries.filter((e) => !prevMap.has(e.key));
  const removed = (previous?.entries ?? []).filter((e) => !nextMap.has(e.key));
  const changed: RosterDiffResult["changed"] = [];
  for (const [key, to] of nextMap) {
    const from = prevMap.get(key);
    if (!from) continue;
    if (
      from.name !== to.name ||
      from.ballotOrder !== to.ballotOrder ||
      !!from.isWriteIn !== !!to.isWriteIn ||
      !!from.isPlaceholder !== !!to.isPlaceholder
    ) {
      changed.push({ key, from, to });
    }
  }

  const reasons: string[] = [];

  // The rule. No threshold, no exception.
  if (removed.length > 0) {
    reasons.push(
      `${removed.length} candidate(s) disappeared from the source: ${removed
        .map((r) => r.name)
        .join(", ")}. A removal requires an attached document.`,
    );
  }

  if (treatEmptyAsFailure && (previous?.entries.length ?? 0) > 0 && next.entries.length === 0) {
    reasons.push(
      "Roster went from non-empty to empty. Treated as a failed fetch, not as a cancelled race.",
    );
  }

  if (expectedCount !== undefined && next.entries.length < expectedCount) {
    reasons.push(
      `Parsed ${next.entries.length} candidates but the certified field is ${expectedCount}. Treated as a failed fetch.`,
    );
  }

  // A ballot line with no name is a missing candidate wearing a placeholder.
  const placeholders = next.entries.filter((e) => e.isPlaceholder);
  if (placeholders.length > 0) {
    reasons.push(
      `${placeholders.length} unnamed ballot line(s). A race cannot be published while a candidate has no name.`,
    );
  }

  // A rename is indistinguishable from one person leaving and another arriving, so
  // near-miss pairs across added/removed are surfaced rather than resolved.
  for (const a of added) {
    for (const r of removed) {
      if (a.key !== r.key && sharesSurname(a.name, r.name)) {
        reasons.push(
          `"${r.name}" disappeared and "${a.name}" appeared. This may be one person spelled two ways — confirm before applying.`,
        );
      }
    }
  }

  return {
    raceKey: next.raceKey,
    added,
    removed,
    changed,
    verdict: reasons.length > 0 ? "QUARANTINED" : "AUTO_APPLIED",
    reasons,
  };
}

function sharesSurname(a: string, b: string): boolean {
  const last = (n: string) => nameKey(n).split(" ").filter(Boolean).at(-1) ?? "";
  const [x, y] = [last(a), last(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  // One-character difference catches Russouw/Rossouw without matching unrelated names.
  return x.length > 4 && y.length > 4 && levenshteinAtMost(x, y, 1);
}

function levenshteinAtMost(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]! <= max;
}

/** Strip per-request tokens before hashing, or these hosts appear to change every poll. */
export function normalizeForHash(html: string): string {
  return html
    // Cloudflare injects a fresh ray id on dallasisd.org at identical byte count.
    .replace(/window\.__CF\$cv\$params\s*=\s*\{[^}]*\}/g, "")
    .replace(/__cf_chl_[a-z_]*\s*[:=]\s*['"][^'"]*['"]/g, "")
    // SharePoint on dallascityhall.com: per-request digest with a second-resolution stamp.
    .replace(/formDigestElement\.value\s*=\s*'[^']*'/g, "")
    .replace(/name="__(VIEWSTATE|VIEWSTATEGENERATOR|EVENTVALIDATION|REQUESTDIGEST)"[^>]*/g, "")
    .replace(/\bserverTime\s*[:=]\s*['"][^'"]*['"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
