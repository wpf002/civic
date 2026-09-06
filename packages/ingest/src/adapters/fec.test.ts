import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFederalRosters, formatFecName, raceKeyFor, toRosters, type FecCandidate } from "./fec.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const page = JSON.parse(readFileSync(join(here, "fec-tx-house-01-2026.json"), "utf8")) as {
  results: FecCandidate[];
  pagination: { count: number; pages: number };
};

describe("FEC name formatting", () => {
  // Every one of these is a real string from the Texas 2026 filings.
  it.each([
    ["MORAN, NATHANIEL QUENTIN", "Nathaniel Quentin Moran"],
    ["CAIN, BRISCOE ROWELL III", "Briscoe Rowell Cain III"],
    ["PAXTON, WARREN KENNETH JR.", "Warren Kenneth Paxton Jr."],
    ["DE LA CRUZ, CARLOS JR.", "Carlos De La Cruz Jr."],
    ["CABILDO, HECTOR MIGUEL MR. JR", "Hector Miguel Cabildo Jr."],
    ["BAEZ, EDGARDO RAFAEL DR", "Edgardo Rafael Baez"],
    ["BARBEE, JAMES BOB MR.", "James Bob Barbee"],
    ["CANSECO, FRANCISCO 'QUICO' RAUL", "Francisco 'Quico' Raul Canseco"],
  ])("%s -> %s", (raw, expected) => {
    expect(formatFecName(raw)).toBe(expected);
  });

  it("keeps casing conventions that a voter would notice", () => {
    expect(formatFecName("MCKINNEY, SARAH")).toBe("Sarah McKinney");
    expect(formatFecName("O'ROURKE, ROBERT")).toBe("Robert O'Rourke");
    expect(formatFecName("SMITH-JONES, ANNA")).toBe("Anna Smith-Jones");
    // Deliberately NOT MacY. Mac is left alone because the rule would mangle it.
    expect(formatFecName("MACY, JOHN")).toBe("John Macy");
  });

  it("never returns an empty name, whatever the input", () => {
    expect(formatFecName("MR.")).toBe("MR.");
    expect(formatFecName("")).toBe("");
  });
});

describe("rosters from real FEC records", () => {
  const observedAt = new Date("2026-09-05T00:00:00Z");

  it("groups one district into one race, keyed by office and district", () => {
    const rosters = toRosters(page.results, "TX", 2026, observedAt);
    expect(rosters).toHaveLength(1);
    expect(rosters[0]!.raceKey).toBe("us-house-tx-01");
    expect(rosters[0]!.entries.map((e) => e.name)).toEqual([
      "Dax Cornell Alexander",
      "Nathaniel Quentin Moran",
      "Yolanda Rena Prince",
      "Masika Akilah Ray",
    ]);
  });

  it("keeps the FEC's own rendering next to the parsed one", () => {
    const [roster] = toRosters(page.results, "TX", 2026, observedAt);
    for (const e of roster!.entries) expect(e.sourceName).toMatch(/^[A-Z' .-]+,/);
  });

  it("pads House districts and gives the Senate no district", () => {
    expect(raceKeyFor("H", "TX", "1")).toBe("us-house-tx-01");
    expect(raceKeyFor("H", "TX", "38")).toBe("us-house-tx-38");
    expect(raceKeyFor("S", "TX", null)).toBe("us-senate-tx");
  });

  it("drops candidates the FEC no longer lists as statutory candidates", () => {
    const withdrawn = [...page.results, { ...page.results[0]!, candidate_id: "H0TX01999", candidate_status: "N" }];
    expect(toRosters(withdrawn, "TX", 2026, observedAt)[0]!.entries).toHaveLength(4);
  });
});

describe("fetching", () => {
  const ok = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  it("refuses a short page rather than reporting a smaller roster", async () => {
    // The FEC says there are 9 candidates and sends 4. A roster that quietly shrinks
    // is the one failure this package exists to prevent.
    const short = { results: page.results, pagination: { count: 9, page: 1, pages: 1, per_page: 100 } };
    await expect(
      fetchFederalRosters("TX", 2026, new Date(), { apiKey: "k", fetchImpl: async () => ok(short) }),
    ).rejects.toThrow(/indistinguishable from candidates disappearing/);
  });

  it("surfaces an API error instead of returning an empty roster", async () => {
    await expect(
      fetchFederalRosters("TX", 2026, new Date(), {
        apiKey: "k",
        fetchImpl: async () => ok({ error: { code: "API_KEY_INVALID" } }),
      }),
    ).rejects.toThrow(/API_KEY_INVALID/);
  });

  it("says how to get a key when none is set", async () => {
    await expect(
      fetchFederalRosters("TX", 2026, new Date(), { apiKey: "", fetchImpl: async () => ok({}) }),
    ).rejects.toThrow(/api\.data\.gov\/signup/);
  });

  it("is always FILED — the FEC does not know who is on a ballot", async () => {
    const full = { results: page.results, pagination: { count: 4, page: 1, pages: 1, per_page: 100 } };
    const empty = { results: [], pagination: { count: 0, page: 1, pages: 1, per_page: 100 } };
    let call = 0;
    const run = await fetchFederalRosters("TX", 2026, new Date(), {
      apiKey: "k",
      fetchImpl: async () => ok(call++ === 0 ? full : empty),
    });
    expect(run.basis).toBe("FILED");
    expect(run.candidateCount).toBe(4);
  });
});

describe("one person, more than one FEC id", () => {
  // Real: Chelsey Hockett filed twice in TX-05, three weeks apart, and the API
  // returns both. Unmerged, her name printed twice on the roster.
  const twice: FecCandidate[] = [
    { ...page.results[0]!, candidate_id: "H6TX05189", name: "HOCKETT, CHELSEY ALEXANDRA", party: "DEM", district: "05", first_file_date: "2025-09-19" },
    { ...page.results[0]!, candidate_id: "H6TX05197", name: "HOCKETT, CHELSEY ALEXANDRA", party: "DEM", district: "05", first_file_date: "2025-10-07" },
  ];

  it("collapses a refiling and keeps the earliest filing as the record", () => {
    const merged: Parameters<typeof toRosters>[4] = [];
    const [roster] = toRosters(twice, "TX", 2026, new Date(), merged);
    expect(roster!.entries).toHaveLength(1);
    expect(roster!.entries[0]!.name).toBe("Chelsey Alexandra Hockett");
    expect(roster!.entries[0]!.sourceUrl).toContain("H6TX05189");
    expect(merged).toEqual([
      { raceKey: "us-house-tx-05", name: "Chelsey Alexandra Hockett", candidateIds: ["H6TX05189", "H6TX05197"] },
    ]);
  });

  it("does NOT merge two people who share a name but not a party", () => {
    const different = [twice[0]!, { ...twice[1]!, party: "REP" }];
    const merged: Parameters<typeof toRosters>[4] = [];
    const [roster] = toRosters(different, "TX", 2026, new Date(), merged);
    // Merging these would delete a candidate, which is the one unrecoverable error.
    expect(roster!.entries).toHaveLength(2);
    expect(merged).toEqual([]);
  });
});
