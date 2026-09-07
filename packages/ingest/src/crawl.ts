/**
 * Finding the pages on a campaign site that actually state positions.
 *
 * A homepage is a poster. The policy content, when it exists, is one link away —
 * the Phase 0 test found Chad West's platform at /policy/, a page the homepage-only
 * archive never fetched. Any yield number produced without crawling is measuring
 * crawl depth as much as it is measuring candidates.
 *
 * Two passes, both bounded:
 *   1. probe a fixed list of conventional paths
 *   2. read the homepage for same-host links whose text or href looks like policy
 *
 * Bounded on purpose. This is someone's campaign server, and the goal is to find
 * the issues page, not to mirror the site.
 */
import { htmlToText } from "./html-text.js";

/** Conventional paths, most common first. */
export const POLICY_PATHS = [
  "/issues",
  "/the-issues",
  "/theissues",
  "/on-the-issues",
  "/priorities",
  "/platform",
  "/policy",
  "/policies",
  "/where-i-stand",
  "/my-priorities",
  "/agenda",
  "/vision",
  "/plan",
  "/plans",
  "/solutions",
  "/about/issues",
];

/** Link text or href that suggests a policy page. */
const POLICY_LINK = /issue|priorit|platform|polic|where\s*i\s*stand|on\s*the\s*issues|my\s*plan|agenda|vision|solutions|stances?/i;

/** Never follow these, even if the text matches. */
const SKIP_LINK = /donate|contribute|volunteer|shop|store|privacy|terms|login|subscribe|unsubscribe|\.pdf$|\.jpg$|\.png$|mailto:|tel:/i;

export interface CrawledPage {
  url: string;
  text: string;
  chars: number;
  /** How it was found: a probed path, or a link off the homepage. */
  via: "home" | "probe" | "link";
}

export interface CrawlResult {
  pages: CrawledPage[];
  /** Every path returned 200, so the site answers 200 for everything. */
  softNotFound: boolean;
  attempted: number;
  /** Why pages were not kept, so a thin result is never mistaken for a silent candidate. */
  outcomes: Record<string, number>;
}

const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 (+civic voter guide)",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

/** Same host, http(s), no fragment. A link off-site is somebody else's words. */
export function sameHostLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const out = new Map<string, string>();

  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]!;
    const text = m[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (SKIP_LINK.test(href) || SKIP_LINK.test(text)) continue;
    if (!POLICY_LINK.test(href) && !POLICY_LINK.test(text)) continue;

    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    u.hash = "";
    const key = u.toString().replace(/\/$/, "");
    if (key === baseUrl.replace(/\/$/, "")) continue;
    if (!out.has(key)) out.set(key, text);
  }
  return [...out.keys()];
}

/** Below this a page is navigation chrome, not a document worth quoting. */
export const MIN_TEXT = 400;

export async function crawlCampaignSite(
  homeUrl: string,
  opts: {
    fetchImpl?: typeof fetch;
    maxPages?: number;
    maxLinks?: number;
    probePaths?: string[];
  } = {},
): Promise<CrawlResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxPages = opts.maxPages ?? 8;
  const maxLinks = opts.maxLinks ?? 6;
  const probePaths = opts.probePaths ?? POLICY_PATHS;

  const outcomes: Record<string, number> = {};
  const pages: CrawledPage[] = [];
  const seen = new Set<string>();
  let attempted = 0;
  let homeText: string | null = null;

  const get = async (url: string, via: CrawledPage["via"]): Promise<string | null> => {
    const key = url.replace(/\/$/, "");
    if (seen.has(key)) return null;
    seen.add(key);
    attempted++;
    try {
      const res = await fetchImpl(url, { redirect: "follow", headers: BROWSER_HEADERS });
      if (!res.ok) {
        const why = res.status === 404 ? "not found" : res.status === 403 || res.status === 429 ? "blocked" : `http ${res.status}`;
        outcomes[why] = (outcomes[why] ?? 0) + 1;
        return null;
      }
      const html = await res.text();
      const text = htmlToText(html);
      if (text.length < MIN_TEXT) {
        outcomes["too thin"] = (outcomes["too thin"] ?? 0) + 1;
        return html;
      }
      if (via === "home") homeText = text;
      pages.push({ url: res.url, text, chars: text.length, via });
      return html;
    } catch {
      outcomes["fetch error"] = (outcomes["fetch error"] ?? 0) + 1;
      return null;
    }
  };

  const homeHtml = await get(homeUrl, "home");

  const origin = new URL(homeUrl).origin;
  for (const path of probePaths) {
    if (pages.length >= maxPages) break;
    await get(`${origin}${path}`, "probe");
  }

  // Some hosts serve the homepage for any path. Every probe "succeeds" and the
  // archive fills with copies of one page, which then reads as a candidate who
  // repeated themselves rather than a site with no issues page.
  //
  // Detected by comparing content, not by counting hits: a count is bounded by the
  // page cap and so can never reach a threshold, and identical text is the actual
  // evidence anyway.
  let softNotFound = false;
  if (homeText) {
    const echoes = pages.filter((p) => p.via === "probe" && p.text === homeText);
    if (echoes.length >= 2) {
      softNotFound = true;
      outcomes["soft 404 site"] = echoes.length;
      for (let i = pages.length - 1; i >= 0; i--) {
        if (pages[i]!.via === "probe" && pages[i]!.text === homeText) pages.splice(i, 1);
      }
    }
  }

  // Two probe paths can also legitimately serve the same page (/issues and
  // /the-issues). Keep one copy of any duplicate rather than archiving both.
  const byText = new Set<string>();
  for (let i = pages.length - 1; i >= 0; i--) {
    if (byText.has(pages[i]!.text)) {
      pages.splice(i, 1);
      outcomes["duplicate page"] = (outcomes["duplicate page"] ?? 0) + 1;
    } else byText.add(pages[i]!.text);
  }

  if (homeHtml && pages.length < maxPages) {
    for (const link of sameHostLinks(homeHtml, homeUrl).slice(0, maxLinks)) {
      if (pages.length >= maxPages) break;
      await get(link, "link");
    }
  }

  return { pages, softNotFound, attempted, outcomes };
}
