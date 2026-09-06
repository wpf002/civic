import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOVEMBER_2026,
  fetchCertifiedRoster,
  formatBallotName,
  raceKeyForOffice,
  stripPii,
  toRosters,
} from "./tx-sos.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const raw = JSON.parse(readFileSync(join(here, "tx-sos-2026-general.json"), "utf8")) as Record<string, unknown>[];

describe("privacy", () => {
  it("the fixture really does contain the personal data we are guarding against", () => {
    // If this ever fails, the test below has stopped proving anything.
    expect(raw.some((r) => r.txEmail)).toBe(true);
    expect(raw.some((r) => r.mailingAddress)).toBe(true);
  });

  it("drops emails and home addresses at the parse boundary", () => {
    for (const row of raw) {
      const clean = stripPii(row);
      if (!clean) continue;
      const serialized = JSON.stringify(clean);
      expect(serialized).not.toMatch(/@/);
      expect(clean).not.toHaveProperty("txEmail");
      expect(clean).not.toHaveProperty("mailingAddress");
    }
  });

  it("is an allow-list, so a new upstream field is excluded by default", () => {
    const clean = stripPii({
      idCandidate: 1,
      idElection: NOVEMBER_2026,
      txFullNameBallot: "JANE DOE",
      txOfficeName: "U. S. REPRESENTATIVE DISTRICT 5",
      dateOfBirth: "1970-01-01",
      txHomePhone: "555-0100",
    } as never);
    expect(clean).not.toHaveProperty("dateOfBirth");
    expect(clean).not.toHaveProperty("txHomePhone");
  });

  it("never carries personal data into a roster entry", () => {
    const rows = raw.map(stripPii).filter((c) => c !== null);
    const run = toRosters(rows as never, NOVEMBER_2026, new Date());
    expect(JSON.stringify(run.rosters)).not.toMatch(/@/);
  });
});

describe("ballot names", () => {
  it.each([
    ["NATHANIEL MORAN", "Nathaniel Moran"],
    ["YOLANDA R.  PRINCE", "Yolanda R. Prince"], // the API really does double-space this
    ['ANGELA "HELI" RODRIGUEZ PRILLIMAN', 'Angela "Heli" Rodriguez Prilliman'],
  ])("%s -> %s", (input, expected) => {
    expect(formatBallotName(input)).toBe(expected);
  });
});

describe("office mapping", () => {
  it("maps the offices this product models", () => {
    expect(raceKeyForOffice("U. S. REPRESENTATIVE DISTRICT 1")).toBe("us-house-tx-01");
    expect(raceKeyForOffice("U. S. REPRESENTATIVE DISTRICT 38")).toBe("us-house-tx-38");
    expect(raceKeyForOffice("U. S. SENATOR")).toBe("us-senate-tx");
  });

  it("returns nothing for offices it does not model, rather than a near match", () => {
    // A county constable roster attached to the wrong race is worse than one that waits.
    for (const o of ["CONSTABLE PRECINCT 1", "STATE REPRESENTATIVE DISTRICT 1", "COUNTY JUDGE", "GOVERNOR"]) {
      expect(raceKeyForOffice(o)).toBeNull();
    }
  });
});

describe("certified rosters from the real response", () => {
  const rows = raw.map(stripPii).filter((c) => c !== null) as never[];

  it("produces the certified two-candidate field for TX-01, not the FEC's four", () => {
    const run = toRosters(rows, NOVEMBER_2026, new Date());
    const d1 = run.rosters.find((r) => r.raceKey === "us-house-tx-01");
    expect(d1!.entries.map((e) => e.name).sort()).toEqual(["Nathaniel Moran", "Yolanda R. Prince"]);
  });

  it("reports unmapped offices with counts instead of dropping them silently", () => {
    const run = toRosters(rows, NOVEMBER_2026, new Date());
    expect(run.unmapped.length).toBeGreaterThan(0);
    expect(run.unmapped[0]!.count).toBeGreaterThan(0);
  });

  it("carries the SOS id so a later run can match without re-deriving it", () => {
    const run = toRosters(rows, NOVEMBER_2026, new Date());
    for (const e of run.rosters[0]!.entries) expect(e.externalIds?.txsos).toMatch(/^\d+$/);
  });

  it("is CERTIFIED, which is the whole reason this source exists", () => {
    expect(toRosters(rows, NOVEMBER_2026, new Date()).basis).toBe("CERTIFIED");
  });
});

describe("fetching an undocumented endpoint", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  it("retries a 500, which this endpoint returns intermittently under load", async () => {
    let n = 0;
    const run = await fetchCertifiedRoster(NOVEMBER_2026, new Date(), {
      sleep: async () => {},
      fetchImpl: async () => (++n < 3 ? ({ ok: false, status: 500 } as Response) : ok(raw)),
    });
    expect(run.candidateCount).toBeGreaterThan(0);
  });

  it("refuses a response that is not the shape it was", async () => {
    await expect(
      fetchCertifiedRoster(NOVEMBER_2026, new Date(), {
        sleep: async () => {},
        fetchImpl: async () => ok({ data: [] }),
      }),
    ).rejects.toThrow(/not an array/);
  });

  it("treats zero candidates for a certified election as a parse failure", async () => {
    await expect(
      fetchCertifiedRoster(999999, new Date(), { sleep: async () => {}, fetchImpl: async () => ok(raw) }),
    ).rejects.toThrow(/parse failure, not a finding/);
  });
});
