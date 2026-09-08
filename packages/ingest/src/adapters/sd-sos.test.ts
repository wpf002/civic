import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSdRoster, parseSdTable, raceKeyForOffice, splitStatus, toRosters } from "./sd-sos.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const html = readFileSync(join(here, "sd-2026-general.html"), "utf8");
const rows = parseSdTable(html);

describe("withdrawal is inside the name", () => {
  it("splits an unclosed parenthetical, which is what the real page has", () => {
    // The real 2026 row is "Julian Beaudion (Withdrawn" with no closing bracket. A
    // stricter pattern misses it and leaves "(Withdrawn" in the surname.
    expect(splitStatus("Julian Beaudion (Withdrawn")).toEqual({
      name: "Julian Beaudion",
      isWithdrawn: true,
    });
    expect(splitStatus("Julian Beaudion (Withdrawn)")).toEqual({
      name: "Julian Beaudion",
      isWithdrawn: true,
    });
  });

  it("leaves an ordinary name alone", () => {
    expect(splitStatus("Mary O'Brien")).toEqual({ name: "Mary O'Brien", isWithdrawn: false });
    // A nickname in brackets is not a status.
    expect(splitStatus('Robert "Bob" Smith')).toEqual({ name: 'Robert "Bob" Smith', isWithdrawn: false });
  });

  it("finds the withdrawn candidate in the real page", () => {
    const w = rows.filter((r) => r.isWithdrawn);
    expect(w.length).toBeGreaterThan(0);
    for (const r of w) expect(r.name).not.toMatch(/withdrawn/i);
  });
});

describe("privacy", () => {
  it("the page really does carry home addresses", () => {
    expect(html).toMatch(/elAddress1|Mailing Address/);
  });

  it("keeps none of them", () => {
    // Allow-list, same rule as Texas and North Carolina.
    for (const r of rows) {
      expect(r).not.toHaveProperty("address");
      expect(JSON.stringify(r)).not.toMatch(/\d{5}(-\d{4})?"/); // no zip
    }
  });
});

describe("rosters", () => {
  it("keeps a withdrawn candidate out of the roster and reports them", () => {
    // Showing a withdrawn candidate as running is the error the roster guard exists
    // to prevent, arriving through the front door this time.
    const run = toRosters(rows, "u", new Date());
    const names = new Set(run.rosters.flatMap((r) => r.entries.map((e) => e.name)));
    expect(run.withdrawn.length).toBeGreaterThan(0);
    for (const w of run.withdrawn) expect(names.has(w.name)).toBe(false);
  });

  it("maps South Dakota's at-large seat", () => {
    expect(raceKeyForOffice("United States Senator")).toBe("us-senate-sd");
    expect(raceKeyForOffice("Representative in Congress")).toBe("us-house-sd-01");
    expect(raceKeyForOffice("Governor")).toBeNull();
  });

  it("reports offices it does not model rather than dropping them", () => {
    expect(toRosters(rows, "u", new Date()).unmapped.length).toBeGreaterThan(0);
  });
});

describe("fetching", () => {
  const ok = (body: string) => ({ ok: true, status: 200, text: async () => body }) as unknown as Response;

  it("reads the real page", async () => {
    const run = await fetchSdRoster("774", new Date(), { fetchImpl: async () => ok(html) });
    expect(run.basis).toBe("FILED");
    expect(run.candidateCount).toBeGreaterThan(0);
  });

  it("treats an empty parse as a failed fetch", async () => {
    // An ASP.NET grid's markup can change without notice.
    await expect(
      fetchSdRoster("774", new Date(), { fetchImpl: async () => ok("<html><body>nothing</body></html>") }),
    ).rejects.toThrow(/failed fetch rather than an election with nobody running/);
  });
});
