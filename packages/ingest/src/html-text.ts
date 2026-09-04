/**
 * HTML → archived text.
 *
 * This function decides what every future verbatim quote is checked against, so its
 * bugs are not cosmetic: a stray character here rejects a correct extraction forever.
 *
 * The trap, found while archiving real Dallas campaign sites. Replacing a tag with a
 * space is right between words and wrong before punctuation:
 *
 *   "For the past six years<em>,</em> Deputy Mayor Pro Tem…"
 *      naive  → "For the past six years , Deputy Mayor Pro Tem"
 *      actual → "For the past six years, Deputy Mayor Pro Tem"
 *
 * A model reading the rendered page quotes the second. The archive holds the first.
 * The gate rejects a correct quote, the reconcile disagrees, and the candidate ends
 * up with a manufactured silence — the same failure class as the hard-wrap bug, from
 * the opposite direction.
 *
 * Deterministic and I/O-free.
 */

const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/g, " "],
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#0?39;|&apos;/g, "'"],
  [/&#8217;|&rsquo;/g, "’"],
  [/&#8216;|&lsquo;/g, "‘"],
  [/&#8220;|&ldquo;/g, "“"],
  [/&#8221;|&rdquo;/g, "”"],
  [/&#8212;|&mdash;/g, "—"],
  [/&#8211;|&ndash;/g, "–"],
  [/&hellip;|&#8230;/g, "…"],
];

/** Tags whose boundaries are real line breaks rather than word spaces. */
const BLOCK = /<\/?(p|div|br|li|h[1-6]|tr|td|section|article|header|footer|nav|blockquote|ul|ol)\b[^>]*>/gi;

export function htmlToText(html: string): string {
  // Sentinels, so a space that came from a tag boundary stays distinguishable from a
  // space the author actually typed. Without that distinction "7<span>—</span>champ"
  // and "7 — champ" are indistinguishable, and one of them is wrong.
  const INLINE = "\u0000";
  const BLOCK_BREAK = "\u0001";

  let s = html.replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, INLINE);
  s = s.replace(/<!--[\s\S]*?-->/g, INLINE);
  s = s.replace(BLOCK, BLOCK_BREAK);
  s = s.replace(/<[^>]+>/g, INLINE);

  for (const [re, to] of ENTITIES) s = s.replace(re, to);
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

  // An inline boundary joins text; it never adds a space. Real whitespace around it
  // is preserved, so "a<b>b</b>c" is "abc" and "a <b>b</b> c" is "a b c".
  s = s.replace(new RegExp(INLINE, "g"), "");

  // Consecutive block boundaries with nothing between them are one break, not several.
  s = s.replace(new RegExp(`(?:[ \t]*${BLOCK_BREAK}[ \t]*)+`, "g"), "\n");

  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
