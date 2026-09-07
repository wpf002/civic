import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOVEMBER_2026,
  fetchNcRoster,
  parseCsv,
  raceKeyForContest,
  stripPii,
  toRosters,
} from "./nc-sbe.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const csv = readFileSync(join(here, "nc-2026-general.csv"), "utf8");
const raw = parseCsv(csv);

describe("privacy", () => {
  it("the fixture really does carry home addresses and personal contact details", () => {
    expect(raw.some((r) => r.email)).toBe(true);
    expect(raw.some((r) => r.street_address)).toBe(true);
  });

  it("drops every one of them at the parse boundary", () => {
    for (const row of raw) {
      const clean = stripPii(row);
      if (!clean) continue;
      const s = JSON.stringify(clean);
      expect(s).not.toMatch(/@/);
      expect(clean).not.toHaveProperty("street_address");
      expect(clean).not.toHaveProperty("phone");
      expect(clean).not.toHaveProperty("zip_code");
    }
  });

  it("never lets contact details reach a roster", () => {
    const rows = raw.map(stripPii).filter((c) => c !== null);
    expect(JSON.stringify(toRosters(rows as never, NOVEMBER_2026, new Date()))).not.toMatch(/@/);
  });
});

describe("the CSV reader", () => {
  it("handles quoted fields, since names and addresses contain commas", () => {
    const rows = parseCsv('"a","b"\n"x, y","z"\n');
    expect(rows).toEqual([{ a: "x, y", b: "z" }]);
  });

  it("handles an escaped quote inside a field", () => {
    const rows = parseCsv('"a"\n"He said ""hi"""\n');
    expect(rows[0]!.a).toBe('He said "hi"');
  });

  it("strips the byte-order mark the file ships with", () => {
    expect(Object.keys(parseCsv('﻿"election_dt"\n"11/03/2026"\n')[0]!)).toEqual(["election_dt"]);
  });
});

describe("contests", () => {
  it("maps the federal contests this product models", () => {
    expect(raceKeyForContest("US SENATE")).toBe("us-senate-nc");
    expect(raceKeyForContest("US HOUSE OF REPRESENTATIVES DISTRICT 01")).toBe("us-house-nc-01");
    expect(raceKeyForContest("US HOUSE OF REPRESENTATIVES DISTRICT 14")).toBe("us-house-nc-14");
  });

  it("returns nothing for the offices with no race yet, rather than guessing", () => {
    for (const c of ["TOWN OF BOONVILLE MAYOR", "YADKIN COUNTY SHERIFF", "NC SUPREME COURT ASSOCIATE JUSTICE SEAT 01"]) {
      expect(raceKeyForContest(c)).toBeNull();
    }
  });
});

describe("rosters", () => {
  const rows = raw.map(stripPii).filter((c) => c !== null) as never[];

  it("collapses a statewide contest that repeats once per county", () => {
    // US SENATE arrives 400 times in the full file: 100 counties x 4 candidates.
    const run = toRosters(rows, NOVEMBER_2026, new Date());
    const senate = run.rosters.find((r) => r.raceKey === "us-senate-nc")!;
    const names = senate.entries.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    expect(run.collapsedRows).toBeGreaterThan(0);
  });

  it("reports municipal and county contests as unmapped instead of dropping them", () => {
    const run = toRosters(rows, NOVEMBER_2026, new Date());
    const contests = run.unmapped.map((u) => u.contest);
    expect(contests).toContain("TOWN OF BOONVILLE MAYOR");
    expect(contests).toContain("YADKIN COUNTY SHERIFF");
  });

  it("is FILED — this is the filing list, not a certified ballot", () => {
    expect(toRosters(rows, NOVEMBER_2026, new Date()).basis).toBe("FILED");
  });

  it("returns nothing for an election date with no rows", () => {
    expect(toRosters(rows, "01/01/2030", new Date()).candidateCount).toBe(0);
  });
});

describe("fetching", () => {
  const ok = (body: string) => ({ ok: true, status: 200, text: async () => body }) as unknown as Response;

  it("refuses a file that is not the file", async () => {
    await expect(
      fetchNcRoster(NOVEMBER_2026, new Date(), { fetchImpl: async () => ok("<html>404</html>") }),
    ).rejects.toThrow(/missing expected columns/);
  });

  it("refuses to report an empty roster when the date simply did not match", async () => {
    await expect(
      fetchNcRoster("01/01/2030", new Date(), { fetchImpl: async () => ok(csv) }),
    ).rejects.toThrow(/Check the election date/);
  });

  it("reads the real file", async () => {
    const run = await fetchNcRoster(NOVEMBER_2026, new Date(), { fetchImpl: async () => ok(csv) });
    expect(run.candidateCount).toBeGreaterThan(0);
    expect(run.rosters.some((r) => r.raceKey === "us-senate-nc")).toBe(true);
  });
});
