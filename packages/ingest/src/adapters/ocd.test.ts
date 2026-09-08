import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./nc-sbe.js";
import { divisionType, parentOf, selectDivisions, stateOf } from "./ocd.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const rows = parseCsv(readFileSync(join(here, "ocd-sample.csv"), "utf8"));

describe("reading an id", () => {
  it("takes the type from the last segment", () => {
    expect(divisionType("ocd-division/country:us/state:tx/place:dallas")).toBe("place");
    expect(divisionType("ocd-division/country:us/state:tx/county:dallas")).toBe("county");
  });

  it("derives the parent from the path, so the tree needs no second lookup", () => {
    expect(parentOf("ocd-division/country:us/state:tx/place:dallas")).toBe(
      "ocd-division/country:us/state:tx",
    );
    expect(parentOf("ocd-division/country:us")).toBeNull();
  });

  it("finds the state even when it is not the last segment", () => {
    expect(stateOf("ocd-division/country:us/state:tx/place:dallas")).toBe("TX");
    expect(stateOf("ocd-division/country:us")).toBeNull();
  });
});

describe("selecting what is usable", () => {
  const picked = selectDivisions(rows);

  it("keeps places, counties and school districts", () => {
    const levels = new Set(picked.map((d) => d.level));
    expect(levels.has("CITY")).toBe(true);
    expect(levels.has("COUNTY")).toBe(true);
  });

  it("drops precincts and wards, which are below any office we model", () => {
    for (const d of picked) {
      expect(d.id).not.toMatch(/\/precinct:/);
      expect(d.id).not.toMatch(/\/ward:/);
    }
  });

  it("drops divisions that no longer exist", () => {
    // OCD keeps retired divisions. One that ended must not be offered as a place
    // someone can vote.
    const retired = rows.filter((r) => r.validThrough);
    expect(retired.length).toBeGreaterThan(0);
    const ids = new Set(picked.map((d) => d.id));
    for (const r of retired) {
      if (new Date(r.validThrough!) < new Date()) expect(ids.has(r.id!)).toBe(false);
    }
  });

  it("filters by state when asked", () => {
    const tx = selectDivisions(rows, { states: ["TX"] });
    expect(tx.length).toBeGreaterThan(0);
    for (const d of tx) expect(d.state).toBe("TX");
  });
});
