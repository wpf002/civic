import { describe, expect, it } from "vitest";
import { MIN_TEXT, crawlCampaignSite, sameHostLinks } from "./crawl.js";

const long = (s: string) => s + " ".padEnd(0) + "x".repeat(MIN_TEXT);
const page = (body: string) => `<html><body>${body}</body></html>`;

describe("finding policy links on a homepage", () => {
  const home = page(`
    <a href="/issues">The Issues</a>
    <a href="/policy/">Where I Stand</a>
    <a href="/about">About Me</a>
    <a href="/donate">Donate</a>
    <a href="https://secure.actblue.com/x">Chip in on the issues</a>
    <a href="https://othersite.org/issues">Their issues</a>
    <a href="/plan.pdf">My plan</a>
    <a href="mailto:a@b.com">Email me on the issues</a>
  `);

  it("follows links whose text or href looks like policy", () => {
    const links = sameHostLinks(home, "https://example.org/");
    expect(links).toContain("https://example.org/issues");
    expect(links).toContain("https://example.org/policy");
  });

  it("never follows off-site links — those are somebody else's words", () => {
    const links = sameHostLinks(home, "https://example.org/");
    expect(links.join(" ")).not.toContain("othersite.org");
    expect(links.join(" ")).not.toContain("actblue");
  });

  it("skips donate, PDFs and mailto even when the text matches", () => {
    const links = sameHostLinks(home, "https://example.org/");
    expect(links.join(" ")).not.toMatch(/donate|\.pdf|mailto/);
  });

  it("treats www and bare host as the same site", () => {
    const links = sameHostLinks(page('<a href="https://www.example.org/issues">Issues</a>'), "https://example.org/");
    expect(links).toHaveLength(1);
  });

  it("does not follow the homepage back to itself", () => {
    expect(sameHostLinks(page('<a href="/">Our issues</a>'), "https://example.org/")).toEqual([]);
  });
});

describe("crawling", () => {
  const ok = (body: string) => ({ ok: true, status: 200, url: "https://example.org/x", text: async () => body }) as unknown as Response;
  const notFound = { ok: false, status: 404 } as Response;

  it("finds a policy page the homepage never showed", async () => {
    const r = await crawlCampaignSite("https://example.org/", {
      fetchImpl: async (u) => {
        const url = String(u);
        if (url.endsWith("/")) return ok(page(long("Vote for me. ")));
        if (url.endsWith("/policy")) return ok(page(long("I will vote to allow duplexes. ")));
        return notFound;
      },
    });
    expect(r.pages.map((p) => p.via)).toEqual(["home", "probe"]);
    expect(r.pages[1]!.text).toContain("allow duplexes");
  });

  it("drops probe hits from a site that answers 200 for everything", async () => {
    // Some hosts serve the homepage for any path. Every probe "succeeds" and the
    // archive fills with copies of one page.
    const r = await crawlCampaignSite("https://example.org/", {
      fetchImpl: async () => ok(page(long("Same page every time. "))),
    });
    expect(r.softNotFound).toBe(true);
    expect(r.pages.every((p) => p.via !== "probe")).toBe(true);
  });

  it("never records a nav bar as a document", async () => {
    const r = await crawlCampaignSite("https://example.org/", {
      fetchImpl: async () => ok(page("<nav>Home About Donate</nav>")),
    });
    expect(r.pages).toHaveLength(0);
    expect(r.outcomes["too thin"]).toBeGreaterThan(0);
  });

  it("says why pages were skipped rather than reporting a silent candidate", async () => {
    const r = await crawlCampaignSite("https://example.org/", {
      fetchImpl: async (u) =>
        String(u).endsWith("/") ? ok(page(long("Home. "))) : ({ ok: false, status: 403 } as Response),
    });
    expect(r.outcomes["blocked"]).toBeGreaterThan(0);
    expect(r.pages).toHaveLength(1);
  });

  it("stays bounded — this is somebody's campaign server", async () => {
    let calls = 0;
    await crawlCampaignSite("https://example.org/", {
      maxPages: 3,
      fetchImpl: async () => {
        calls++;
        return ok(page(long('<a href="/issues-' + calls + '">issues</a> ')));
      },
    });
    expect(calls).toBeLessThanOrEqual(POLICY_PATH_BUDGET);
  });
});

// homepage + 16 probes + at most 6 links
const POLICY_PATH_BUDGET = 23;

describe("client-rendered sites", () => {
  const shell = '<html><body><div id="root"></div><script src="/main.js"></script></body></html>';
  const okShell = () =>
    ({ ok: true, status: 200, url: "https://example.org/", text: async () => shell }) as unknown as Response;

  it("does not launch a browser unless the plain fetch already failed", async () => {
    let rendered = 0;
    await crawlCampaignSite("https://example.org/", {
      renderJs: true,
      probePaths: [],
      maxLinks: 0,
      fetchImpl: async () =>
        ({ ok: true, status: 200, url: "https://example.org/", text: async () => page(long("Real content. ")) }) as unknown as Response,
      renderImpl: (async () => {
        rendered++;
        return { url: "x", text: "", html: "" };
      }) as never,
    });
    expect(rendered).toBe(0);
  });

  it("recovers a site that only exists after JavaScript runs", async () => {
    const r = await crawlCampaignSite("https://example.org/", {
      renderJs: true,
      probePaths: [],
      maxLinks: 0,
      fetchImpl: async () => okShell(),
      renderImpl: (async () => ({
        url: "https://example.org/",
        text: long("I will vote to raise the minimum wage. "),
        html: "",
      })) as never,
    });
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]!.text).toContain("raise the minimum wage");
    expect(r.outcomes["rendered"]).toBe(1);
  });

  it("counts a render failure rather than pretending the page was empty", async () => {
    const r = await crawlCampaignSite("https://example.org/", {
      renderJs: true,
      probePaths: [],
      maxLinks: 0,
      fetchImpl: async () => okShell(),
      renderImpl: (async () => {
        throw new Error("browser crashed");
      }) as never,
    });
    expect(r.outcomes["render failed"]).toBe(1);
    expect(r.pages).toHaveLength(0);
  });
});
