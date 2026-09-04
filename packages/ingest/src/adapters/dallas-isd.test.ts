import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANDIDATES_MARKER,
  INDEX_MARKER,
  discoverCandidatePages,
  discoverRosterDocuments,
  fetchIsdRoster,
  parseCandidatesPage,
} from "./dallas-isd.js";
import { diffRoster } from "../roster.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const indexHtml = readFileSync(join(here, "disd-index.html"), "utf8");
const candidatesHtml = readFileSync(join(here, "disd-candidates-2026-05-02.html"), "utf8");

describe("index discovery", () => {
  it("finds the candidates page from the index and dates it from the slug", () => {
    const pages = discoverCandidatePages(indexHtml);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]!.electionDate).toBe("2026-05-02");
    expect(pages[0]!.url).toContain("may-2-2026-general-election-candidates");
  });

  it("does not depend on the page title, which is stale on the real site", () => {
    // The May 2025 page titled itself May 4 2024. The slug is the only trustworthy date.
    const pages = discoverCandidatePages(
      `<a href="/x/may-3-2025-general-election-candidates">whatever</a>`,
    );
    expect(pages[0]!.electionDate).toBe("2025-05-03");
  });

  it("finds the documents that justify a name leaving a roster", () => {
    const docs = discoverRosterDocuments(indexHtml);
    const cancellations = docs.filter((d) => d.kind === "ORDER_OF_CANCELLATION");
    expect(cancellations.length).toBeGreaterThan(0);
    // District 8 was cancelled for May 2026 because it was unopposed.
    expect(cancellations.some((c) => c.district === "8")).toBe(true);
    expect(cancellations[0]!.url).toMatch(/^https:\/\//);
  });
});

describe("roster parsing against the live page", () => {
  const rosters = parseCandidatesPage(candidatesHtml, "https://example.org/p");

  it("groups candidates under their trustee district", () => {
    expect(rosters.map((r) => r.district)).toEqual(["2", "6", "8"]);
  });

  it("reads the real names", () => {
    const d2 = rosters.find((r) => r.district === "2")!;
    expect(d2.entries.map((e) => e.name)).toEqual(["Sarah Weinberg", "Winnetka K. Smith-Alford"]);
    const d8 = rosters.find((r) => r.district === "8")!;
    expect(d8.entries.map((e) => e.name)).toEqual(["Joe Carreon"]);
  });

  it("does not turn footer links into candidates", () => {
    const names = rosters.flatMap((r) => r.entries.map((e) => e.name.toLowerCase()));
    for (const junk of ["twitter", "facebook", "youtube", "instagram", "flickr", "footer logo"]) {
      expect(names).not.toContain(junk);
    }
  });
});

describe("the failure this adapter exists to prevent", () => {
  const fake = (pages: Record<string, string>) => async (url: string, marker: string) => {
    const html = pages[url];
    if (html === undefined) throw new Error(`unexpected fetch ${url}`);
    if (!html.includes(marker)) throw new Error(`marker missing`);
    return { html, normalizedHash: "h" };
  };

  it("refuses to parse when the requested election is not linked yet", async () => {
    await expect(
      fetchIsdRoster("2027-11-02", new Date(), fake({ [
        "https://www.dallasisd.org/board-of-trustees/elections-information"
      ]: indexHtml })),
    ).rejects.toThrow(/not yet published/);
  });

  it("refuses a page that 200s without the expected marker", async () => {
    await expect(
      fetchIsdRoster("2026-05-02", new Date(), fake({
        "https://www.dallasisd.org/board-of-trustees/elections-information": "<html>a login page</html>",
      })),
    ).rejects.toThrow();
    expect(indexHtml.includes(INDEX_MARKER)).toBe(true);
    expect(candidatesHtml.includes(CANDIDATES_MARKER)).toBe(true);
  });

  it("quarantines rather than applying when a real candidate disappears", () => {
    const parsed = parseCandidatesPage(candidatesHtml, "u");
    const d2 = parsed.find((r) => r.district === "2")!;
    const before = { raceKey: "disd-2", entries: d2.entries, sourceUrl: "u", observedAt: new Date() };
    // Replay: Weinberg withdraws and the page simply stops listing her.
    const after = { ...before, entries: d2.entries.filter((e) => e.name !== "Sarah Weinberg") };
    const d = diffRoster(before, after);
    expect(d.verdict).toBe("QUARANTINED");
    expect(d.removed.map((r) => r.name)).toEqual(["Sarah Weinberg"]);
  });

  it("quarantines the unopposed-cancellation case rather than emptying the race", () => {
    // District 8 is unopposed and its election was cancelled by order. If the page
    // later drops Carreon, that is still a removal needing the order attached.
    const parsed = parseCandidatesPage(candidatesHtml, "u");
    const d8 = parsed.find((r) => r.district === "8")!;
    const before = { raceKey: "disd-8", entries: d8.entries, sourceUrl: "u", observedAt: new Date() };
    const d = diffRoster(before, { ...before, entries: [] });
    expect(d.verdict).toBe("QUARANTINED");
  });
});
