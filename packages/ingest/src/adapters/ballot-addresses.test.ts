import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { censusNameFor, oneLine, parseOutlets, pickPerDistrict } from "./ballot-addresses.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const csv = readFileSync(join(here, "imls-outlets-excerpt.csv"), "latin1");

describe("library addresses", () => {
  const libs = parseOutlets(csv);

  it("keeps buildings with a street address and drops bookmobiles", () => {
    expect(libs.length).toBe(3);
    expect(libs.every((l) => l.address && Number.isFinite(l.lat))).toBe(true);
  });

  it("keeps only the building's location", () => {
    expect(Object.keys(libs[0]!).sort()).toEqual(["address", "block", "cd119", "city", "lat", "lon", "state", "zip"]);
  });

  it("names the survey's district the way the Census layer does", () => {
    expect(censusNameFor("TX", "30")).toBe("Congressional District 30");
    expect(censusNameFor("WY", "00")).toBe("Congressional District (at Large)");
    expect(censusNameFor("DC", "98")).toBe("Congressional District (at Large)");
  });

  it("picks the same address for a district on every run", () => {
    const placed = libs.map((library) => ({ library, seat: "District 1" }));
    const a = pickPerDistrict(placed);
    const b = pickPerDistrict([...placed].reverse());
    expect([...a.values()].flat().map(oneLine)).toEqual([...b.values()].flat().map(oneLine));
  });
});
