import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCertifiedList } from "./ca-sos.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
// Lines extracted from the Secretary of State's certified list PDF, August 27 2026.
const lines = readFileSync(join(here, "ca-cert-list-excerpt.txt"), "utf8").split("\n");

describe("California's certified list", () => {
  const run = parseCertifiedList(lines, new Date());
  const race = (k: string) => run.rosters.find((r) => r.raceKey === k)?.entries.map((e) => `${e.name}/${e.party ?? ""}`);

  it("reads name lines and skips ballot designations", () => {
    expect(race("governor-ca")).toEqual(["Xavier Becerra/D", "Steve Hilton/R"]);
    // Party on its own line above the name, and an incumbent star.
    expect(race("statewide-ca-secretary-of-state")).toEqual(["Shirley N. Weber/D", "Donald P. (Don) Wagner/R"]);
    expect(race("statewide-ca-attorney-general")).toEqual(["Rob Bonta/D", "Michael E. Gates/R"]);
  });

  it("allows two candidates of one party, as top-two does", () => {
    expect(race("us-house-ca-04")).toEqual(["Eric Jones/D", "Mike Thompson/D"]);
    expect(race("us-house-ca-06")).toEqual(["Richard Pan/D", "Kevin Kiley/I"]);
  });

  it("reads a nonpartisan office without inventing a party", () => {
    expect(race("statewide-ca-superintendent-of-public-instruction")).toEqual(["Richard Barrera/", "Sonja Shaw/"]);
  });

  it("maps both chambers and lists single-candidate contests for review", () => {
    expect(race("state-senate-ca-4")).toEqual(["Jaron Brandon/D", "Alexandra Duarte/R"]);
    expect(race("state-house-ca-4")).toEqual(["Cecilia M. Aguiar-Curry/D"]);
    expect(run.unopposed).toEqual(["state-house-ca-4"]);
    expect(run.offices.get("state-house-ca-5")).toEqual({ title: "State Representative", seatLabel: "House District 5", chamber: "lower" });
  });

  it("skips the Board of Equalization and judicial retention questions", () => {
    expect(run.rosters.some((r) => /equalization/i.test(r.raceKey))).toBe(false);
    expect(JSON.stringify(run.rosters)).not.toMatch(/ADAMS|Shall/);
    expect(run.rejected).toEqual([]);
  });
});
