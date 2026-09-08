/**
 * Fetching a page that only exists after JavaScript runs.
 *
 * Three Texas candidates archived as 0, 41 and 48 characters — a navigation bar and
 * nothing else — because their sites render entirely client-side. Stored as-is,
 * those would have read as candidates who said nothing, which is a claim about them
 * rather than about our fetcher.
 *
 * This is the slow path and it is used ONLY as a fallback. A plain fetch is tried
 * first for every page; a browser is launched only when that returns too little text
 * to be a document. Rendering everything would be twenty times the cost and time for
 * a handful of sites.
 *
 * The browser is a real one, which means it will run whatever the page ships. It is
 * given no credentials, no storage that outlives the page, and no ability to
 * navigate anywhere the caller did not ask for.
 */
import { htmlToText } from "./html-text.js";

export interface RenderResult {
  url: string;
  text: string;
  html: string;
}

/** Loaded lazily so importing this module never requires a browser binary. */
async function launch() {
  const { chromium } = await import("playwright");
  return chromium.launch({ args: ["--disable-dev-shm-usage"] });
}

export interface RenderOptions {
  /** How long to wait for the page to settle. */
  timeoutMs?: number;
  /** Injectable for tests, which must never launch a browser. */
  launchImpl?: typeof launch;
}

/**
 * Render one page and return its text.
 *
 * Waits for the network to go quiet rather than for a fixed delay: a fixed wait is
 * either too short for a slow site or wasted on a fast one, and the failure mode of
 * "too short" is archiving a loading spinner as a candidate's platform.
 */
export async function renderPage(url: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const browser = await (opts.launchImpl ?? launch)();
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 (+civic voter guide)",
      // A fresh context each time, so nothing persists between candidates: no
      // cookies, no storage, no credentials. Omitting storageState is what gives
      // that, rather than passing an empty one.
      javaScriptEnabled: true,
    });
    const page = await context.newPage();

    // Images and fonts are not text and cost most of the load time.
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "font" || type === "media") return route.abort();
      return route.continue();
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: opts.timeoutMs ?? 30_000 });
    const html = await page.content();
    const finalUrl = page.url();
    await context.close();
    return { url: finalUrl, text: htmlToText(html), html };
  } finally {
    await browser.close();
  }
}

/**
 * Decide whether a page is worth re-fetching with a browser.
 *
 * Only when the plain fetch produced too little to quote AND the HTML looks like an
 * app shell. A site that is genuinely a one-line page should not cost a browser
 * launch, and a 404 should not either.
 */
export function looksClientRendered(html: string, extractedText: string, minText = 400): boolean {
  if (extractedText.length >= minText) return false;
  // Only "nothing came back at all". An app shell can legitimately be tiny — a bare
  // <app-root ng-version="17"> is about seventy characters and is exactly the case
  // this function exists to catch.
  if (!html || html.trim().length < 30) return false;
  return (
    /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(html) ||
    /<script[^>]+src=[^>]*\/(main|app|bundle|runtime|index)[.-][^"']*\.js/i.test(html) ||
    /data-reactroot|ng-version|__NEXT_DATA__|window\.__NUXT__/i.test(html) ||
    // A shell whose body is almost entirely script tags.
    (html.match(/<script/gi)?.length ?? 0) >= 3
  );
}
