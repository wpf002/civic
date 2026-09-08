import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readXlsx } from "../xlsx.js";
import {
  fetchStateRoster,
  parseColorado,
  parseMaine,
  raceKeyColorado,
  raceKeyMaine,
  toRosters,
} from "./xlsx-states.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const meBuf = readFileSync(join(here, "me-2026-general.xlsx"));
const coBuf = readFileSync(join(here, "co-2026-general.xlsx"));
const me = parseMaine(readXlsx(meBuf));
const co = parseColorado(readXlsx(coBuf));

describe("Maine", () => {
  it("assembles a name from its separate columns", () => {
    const collins = me.find((c) => c.name.includes("Collins"))!;
    expect(collins.name).toBe("Susan M. Collins");
    expect(collins.office).toBe("US");
    expect(collins.party).toBe("R");
    // Statewide: no district. If the empty-cell bug ever returns this becomes "R".
    expect(collins.district).toBeNull();
  });

  it("reaches county row officers, which is its real ceiling", () => {
    const run = toRosters(me, "ME", "u", new Date());
    expect(run.coverageCeiling).toBe("county");
    const offices = run.unmapped.map((u) => u.office);
    expect(offices).toEqual(expect.arrayContaining(["SR", "CC"]));
  });

  it("maps its abbreviated federal offices", () => {
    expect(raceKeyMaine("US", null)).toBe("us-senate-me");
    expect(raceKeyMaine("CG", "1")).toBe("us-house-me-01");
    expect(raceKeyMaine("CG", "2")).toBe("us-house-me-02");
    expect(raceKeyMaine("SR", "12")).toBeNull();
  });
});

describe("Colorado", () => {
  it("does not turn 'State' into a district", () => {
    // Colorado writes "State" in the district column for a statewide office.
    const senate = co.filter((c) => c.office === "US Senate");
    expect(senate.length).toBeGreaterThan(0);
    for (const c of senate) expect(c.district).toBeNull();
  });

  it("records write-in candidates as such", () => {
    expect(co.some((c) => c.isWriteIn === false)).toBe(true);
  });

  it("stops at state level, and says so", () => {
    const run = toRosters(co, "CO", "u", new Date());
    expect(run.coverageCeiling).toBe("state");
  });

  it("maps its federal offices", () => {
    expect(raceKeyColorado("US Senate", null)).toBe("us-senate-co");
    expect(raceKeyColorado("US House District 4", "4")).toBe("us-house-co-04");
    expect(raceKeyColorado("Regent of the University of Colorado", null)).toBeNull();
  });
});

describe("fetching", () => {
  const ok = (b: Buffer) =>
    ({ ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }) as unknown as Response;

  it("reads both real files end to end", async () => {
    for (const [state, buf] of [["ME", meBuf], ["CO", coBuf]] as const) {
      const run = await fetchStateRoster(state, new Date(), { fetchImpl: async () => ok(buf) });
      expect(run.basis).toBe("FILED");
      expect(run.candidateCount).toBeGreaterThan(0);
    }
  });

  it("treats an empty parse as a failed fetch, not an empty election", async () => {
    // These states put a revision date in the filename, so a moved or relaid-out
    // file is the likely cause and must not read as nobody running.
    const empty = readFileSync(join(here, "co-2026-general.xlsx"));
    await expect(
      fetchStateRoster("ME", new Date(), { fetchImpl: async () => ok(empty) }),
    ).rejects.toThrow(/not an election with nobody running/);
  });
});
