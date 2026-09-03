/**
 * The evidence gate.
 *
 * Every stored Evidence.quote must be the candidate's actual words, in order,
 * from the archived source. The naive implementation of that rule is
 * `sourceText.includes(quote)` — but it fails on a difference that is not a
 * fidelity problem: source documents contain hard line wraps, and a model that
 * unwraps them while copying has altered no words. Rejecting that sends correct
 * extractions to the review queue and makes two-model agreement impossible.
 *
 * So the match is whitespace-insensitive and nothing else. Different words,
 * reordered words, changed punctuation, or curly-vs-straight quotes still fail:
 * those are alterations, and an altered quote is not evidence.
 *
 * The important part is what comes back. On a match we return the span from the
 * ORIGINAL source, not the string the model produced. The stored quote is
 * therefore a byte-exact slice of the archived text by construction, and no
 * model output is ever written to Evidence.quote.
 *
 * Deterministic and I/O-free, like the matcher.
 */

/** Collapse every run of whitespace to a single space, and record where each kept character came from. */
function normalizeWithMap(s: string): { text: string; offsets: number[] } {
  let text = "";
  const offsets: number[] = [];
  let inRun = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      if (!inRun && text.length > 0) {
        text += " ";
        offsets.push(i);
      }
      inRun = true;
      continue;
    }
    inRun = false;
    text += ch;
    offsets.push(i);
  }
  // A trailing space would index one past the last real character; drop it.
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    offsets.pop();
  }
  return { text, offsets };
}

export function normalizeWhitespace(s: string): string {
  return normalizeWithMap(s).text;
}

export interface VerbatimMatch {
  /** The span as it appears in the archived source. This is what gets stored. */
  quote: string;
  start: number;
  end: number;
  /** True when the model's string was not byte-identical to the source span. */
  rewrapped: boolean;
}

/**
 * Locate `quote` in `sourceText`, ignoring only differences in whitespace.
 * Returns null when the words are not present in that order.
 */
export function findVerbatim(sourceText: string, quote: string): VerbatimMatch | null {
  if (quote.trim() === "") return null;

  // Fast path: an exact hit needs no mapping.
  const exact = sourceText.indexOf(quote);
  if (exact !== -1) {
    return { quote, start: exact, end: exact + quote.length, rewrapped: false };
  }

  const src = normalizeWithMap(sourceText);
  const needle = normalizeWhitespace(quote);
  if (needle === "") return null;

  const at = src.text.indexOf(needle);
  if (at === -1) return null;

  const start = src.offsets[at]!;
  const lastKept = src.offsets[at + needle.length - 1]!;
  return { quote: sourceText.slice(start, lastKept + 1), start, end: lastKept + 1, rewrapped: true };
}

/** True when the quote's words appear in the source in order. Whitespace-insensitive. */
export function isVerbatim(sourceText: string, quote: string): boolean {
  return findVerbatim(sourceText, quote) !== null;
}
