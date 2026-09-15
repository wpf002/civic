import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseList, raceKeyForOffice, toRosters } from "./in-sos.js";
import { isGeneralBallot } from "../roster.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
// Rows from the Election Division's abbreviated candidate list, September 11 2026.
const rows = JSON.parse(readFileSync(join(here, "in-candidate-list-rows.json"), "utf8")) as string[][];

describe("Indiana's candidate list", () => {
  const parsed = parseList(rows);
  const run = toRosters(parsed, "u", new Date());
  const race = (k: string) => run.rosters.find((r) => r.raceKey === k)?.entries;

  it("skips section headers and reads write-ins without inventing a party", () => {
    expect(parsed.some((c) => c.name === "OFFICE TITLE" || c.party === "PARTY")).toBe(false);
    const wi = parsed.find((c) => c.isWriteIn);
    expect(wi?.party).toBeNull();
  });

  it("maps ordinal House districts, statewide officers and both chambers, and not courts", () => {
    expect(raceKeyForOffice("United States Representative, Seventh District")).toBe("us-house-in-07");
    expect(raceKeyForOffice("State Representative, District 001")).toBe("state-house-in-1");
    expect(raceKeyForOffice("Secretary of State")).toBe("statewide-in-secretary-of-state");
    expect(raceKeyForOffice("Judge of the Benton Circuit Court, 76th Judicial Circuit")).toBeNull();
    expect(race("us-house-in-07")!.map((e) => `${e.name}/${e.party}`)).toEqual(["André Carson/D", "James M Sceniak/L", "Patrick McAuley/R"]);
  });

  it("reads as the general ballot after the primary", () => {
    expect(isGeneralBallot(run.rosters)).toBe(true);
  });
});
