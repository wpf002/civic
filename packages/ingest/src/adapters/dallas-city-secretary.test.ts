import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LISTING_MARKER,
  ballotOrderUrl,
  dedupeFiled,
  extractPdfItems,
  parseBallotOrder,
  parseDirectoryListing,
  parseFiledApplications,
  reconcile,
  type CertifiedPlace,
} from "./dallas-city-secretary.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const appsHtml = readFileSync(join(here, "dallas-apps-2025.html"), "utf8");

describe("IIS directory listing", () => {
  const files = parseDirectoryListing(appsHtml);

  it("parses the uppercase <A HREF> rows with their size and mtime", () => {
    expect(files.length).toBe(60);
    expect(files[0]!.sizeBytes).toBeGreaterThan(0);
    expect(files[0]!.modifiedAt).toMatch(/\d+\/\d+\/\d{4}/);
    expect(files[0]!.url).toMatch(/^https:\/\/citysecretary2\./);
  });

  it("carries the marker that proves the page is the page", () => {
    expect(appsHtml).toContain(LISTING_MARKER);
  });
});

describe("filed applications", () => {
  const filed = dedupeFiled(parseFiledApplications(parseDirectoryListing(appsHtml)));

  it("derives place and name from the filename, since the PDFs are scans", () => {
    const p1 = filed.filter((f) => f.place === "1").map((f) => f.name).sort();
    expect(p1).toEqual(["Chad West", "Jason Vanhof", "Katrina Whatley"]);
  });

  it("collapses resubmitted applications instead of counting them twice", () => {
    // "03 - John Sims.pdf" and "03 - John Sims2.pdf" are one person.
    expect(parseDirectoryListing(appsHtml).length).toBe(60);
    expect(filed.length).toBe(54);
    const sims = filed.filter((f) => f.name.startsWith("John Sims"));
    expect(sims).toHaveLength(1);
  });
});

describe("certified ballot order", () => {
  let certified: CertifiedPlace[];
  beforeAll(async () => {
    const bytes = new Uint8Array(readFileSync(join(here, "dallas-ballot-order-2025.pdf")));
    certified = parseBallotOrder(await extractPdfItems(bytes));
  }, 60_000);

  it("keeps the two-column layout apart", () => {
    // A reading-order extraction interleaves Place 1 with Place 8.
    expect(certified.map((c) => c.place)).toEqual(
      ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15"],
    );
  });

  it("reads names off lines where the number is a separate text item", () => {
    const p6 = certified.find((c) => c.place === "6")!;
    expect(p6.entries.map((e) => e.name)).toContain("David Blewett");
    expect(p6.entries.map((e) => e.name)).toContain('Nicolas "Nico" Quintanilla');
    expect(p6.entries.filter((e) => !e.isPlaceholder)).toHaveLength(8);
  });

  it("records ballot order rather than inventing one", () => {
    const p1 = certified.find((c) => c.place === "1")!;
    expect(p1.entries.map((e) => [e.ballotOrder, e.name])).toEqual([
      [1, "Jason Vanhof"],
      [2, "Katrina Whatley"],
      [3, "Chad West"],
    ]);
  });

  it("flags every unnamed ballot line as a placeholder", () => {
    const placeholders = certified.flatMap((c) =>
      c.entries.filter((e) => e.isPlaceholder).map((e) => `${c.place}:${e.name}`),
    );
    // Four write-in lines with no name, plus Place 15's bare "1".
    expect(placeholders).toEqual([
      "6:Write-In Candidate",
      "7:Write-In Candidate",
      "9:Write-In Candidate",
      "10:Write-In Candidate",
      "15:(unnamed ballot line)",
    ]);
  });
});

describe("filed vs certified — they disagree in both directions", () => {
  let rows: ReturnType<typeof reconcile>;
  beforeAll(async () => {
    const bytes = new Uint8Array(readFileSync(join(here, "dallas-ballot-order-2025.pdf")));
    const certified = parseBallotOrder(await extractPdfItems(bytes));
    const filed = dedupeFiled(parseFiledApplications(parseDirectoryListing(appsHtml)));
    rows = reconcile(filed, certified);
  }, 60_000);

  it("finds the real 2025 respellings", () => {
    const pairs = rows.flatMap((r) => r.probableRespellings.map((p) => `${p.filed}→${p.certified}`));
    expect(pairs).toContain("Sukhbri Kaur→Sukhbir Kaur");
    expect(pairs).toContain("Marc Russouw→Marc Rossouw");
    expect(pairs).toContain("William Roth→Bill Roth");
  });

  it("proposes a respelling and never merges it", () => {
    // A proposal leaves BOTH sides listed, so a human still has to decide.
    const p2 = rows.find((r) => r.place === "2")!;
    expect(p2.filedOnly).toContain("Sukhbri Kaur");
    expect(p2.certifiedOnly).toContain("Sukhbir Kaur");
  });

  it("finds people who filed and did not make the ballot", () => {
    const p4 = rows.find((r) => r.place === "4")!;
    // Real 2025 filers who are absent from the certified order.
    expect(p4.filedOnly).toContain("Carolyn Arnold");
    expect(p4.filedOnly).toContain("Landers Isom");
  });

  it("counts placeholders per place", () => {
    expect(rows.find((r) => r.place === "15")!.placeholders).toBe(1);
    expect(rows.find((r) => r.place === "1")!.placeholders).toBe(0);
  });
});

describe("urls", () => {
  it("builds the per-year paths", () => {
    expect(ballotOrderUrl(2027)).toBe(
      "https://citysecretary2.dallascityhall.com/pdf/Elections/2027/BallotOrder.pdf",
    );
  });
});
