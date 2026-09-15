import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExtract, toRosters } from "./fl-dos.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
// Rows from the Division of Elections extract for 20261103-GEN, contact columns redacted.
const tsv = readFileSync(join(here, "fl-2026-general-extract.tsv"), "utf8");

describe("Florida's candidate extract", () => {
  const rows = parseExtract(tsv);
  const run = toRosters(rows, "u", new Date());
  const race = (k: string) => run.rosters.find((r) => r.raceKey === k);

  it("keeps only the ballot facts", () => {
    expect(Object.keys(rows[0]!).sort()).toEqual(["district", "name", "officeCode", "partyCode", "status"]);
  });

  it("puts only Qualified candidates on the ballot", () => {
    for (const r of run.rosters) expect(r.entries.length).toBeGreaterThan(0);
    const gov = race("governor-fl")!.entries.map((e) => e.name);
    for (const d of rows.filter((x) => x.officeCode === "GOV" && x.status !== "Qualified")) expect(gov).not.toContain(d.name);
    // An unopposed candidate is elected without appearing on the ballot.
    expect(run.rosters.some((r) => r.entries.some((e) => rows.find((x) => x.name === e.name)?.status === "Unopposed"))).toBe(false);
    expect(race("governor-fl")!.entries.map((e) => e.name)).toContain("Byron Donalds");
  });

  it("marks write-ins and maps Florida's party codes", () => {
    const gov = race("governor-fl")!.entries;
    expect(gov.find((e) => e.name.startsWith("Kathy"))?.isWriteIn).toBe(true);
    expect(gov.find((e) => e.name === "David Jolly")?.party).toBe("D");
    expect(gov.find((e) => e.name.startsWith("Charles"))?.party).toBe("I");
  });

  it("maps the special Senate election, a House seat and the legislature, and leaves courts out", () => {
    const senate = rows.filter((x) => x.officeCode === "USS" && x.status === "Qualified").map((x) => x.name).sort();
    expect(race("us-senate-fl")!.entries.map((e) => e.name)).toEqual(senate);
    expect(race("us-house-fl-07")).toBeDefined();
    expect(run.rosters.some((r) => r.raceKey.startsWith("state-senate-fl-"))).toBe(true);
    expect(run.unmapped.map((u) => u.office)).not.toContain("GOV");
  });
});
