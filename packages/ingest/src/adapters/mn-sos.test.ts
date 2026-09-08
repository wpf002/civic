import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOVEMBER_2026,
  decodeLatin1,
  fetchMnRoster,
  parseLocalFile,
  parseStateFile,
  raceKeyForOffice,
  toRosters,
} from "./mn-sos.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const candBytes = readFileSync(join(here, "mn-cand-20261103.txt"));
const localBytes = readFileSync(join(here, "mn-local-20261103.txt"));
const cand = decodeLatin1(new Uint8Array(candBytes));
const local = decodeLatin1(new Uint8Array(localBytes));

describe("encoding", () => {
  it("reads the file as Latin-1, because it is not UTF-8", () => {
    // Read as UTF-8 this file throws on the first accented name. A lenient decoder
    // would substitute instead and put a mangled name on a ballot listing.
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(candBytes))).toThrow();
    expect(cand.length).toBeGreaterThan(1000);
    expect(cand).not.toContain("�");
  });
});

describe("the two files are different shapes", () => {
  const state = parseStateFile(cand);
  const localRows = parseLocalFile(local);

  it("parses state and federal offices", () => {
    expect(state.length).toBeGreaterThan(1000);
    expect(state.every((r) => r.file === "state")).toBe(true);
    expect(state.some((r) => r.officeName === "U.S. Senator")).toBe(true);
  });

  it("parses the local file, which is the layer Texas has none of", () => {
    expect(localRows.length).toBeGreaterThan(100);
    expect(localRows.every((r) => r.file === "local")).toBe(true);
    expect(localRows.some((r) => /Township|City|School/i.test(r.officeName))).toBe(true);
  });

  it("does not read one file with the other's field positions", () => {
    // The columns differ. A name read from the wrong index is silently wrong.
    for (const r of [...state, ...localRows]) {
      expect(r.name).not.toMatch(/^\d+$/);
      expect(r.officeName).not.toMatch(/^\d+$/);
    }
  });
});

describe("write-in lines", () => {
  it("marks WRITE-IN as a placeholder, not a person", () => {
    const rows = parseLocalFile(local).filter((r) => r.isWriteIn);
    expect(rows.length).toBeGreaterThan(0);
    const run = toRosters(
      [{ ...rows[0]!, officeName: "U.S. Senator" }],
      new Date(),
      "https://example.org/cand.txt",
    );
    const entry = run.rosters[0]!.entries[0]!;
    expect(entry.isPlaceholder).toBe(true);
    expect(entry.isWriteIn).toBe(true);
  });
});

describe("offices", () => {
  it("maps the federal contests", () => {
    expect(raceKeyForOffice("U.S. Senator")).toBe("us-senate-mn");
    expect(raceKeyForOffice("U.S. Representative District 1")).toBe("us-house-mn-01");
    expect(raceKeyForOffice("U.S. Representative District 8")).toBe("us-house-mn-08");
  });

  it("reports state and local offices as unmapped rather than dropping them", () => {
    const run = toRosters(parseStateFile(cand), new Date(), "u");
    expect(run.unmapped.length).toBeGreaterThan(0);
    expect(run.unmapped.some((u) => /Governor|Attorney|Representative|Senator/i.test(u.officeName))).toBe(true);
  });
});

describe("fetching", () => {
  const bytes = (s: Uint8Array) =>
    ({ ok: true, status: 200, arrayBuffer: async () => s.buffer }) as unknown as Response;

  it("refuses to report an empty state file as an election with nobody running", async () => {
    await expect(
      fetchMnRoster(NOVEMBER_2026, new Date(), {
        fetchImpl: async () => bytes(new TextEncoder().encode("")),
      }),
    ).rejects.toThrow(/not an election with nobody running/);
  });

  it("still returns a roster when the local file is missing", async () => {
    let n = 0;
    const run = await fetchMnRoster(NOVEMBER_2026, new Date(), {
      fetchImpl: async () =>
        ++n === 1 ? bytes(new Uint8Array(candBytes)) : ({ ok: false, status: 404 } as Response),
    });
    expect(run.candidateCount).toBeGreaterThan(0);
    expect(run.fromLocal).toBe(0);
  });

  it("counts what each file contributed, so a missing file is visible", async () => {
    let n = 0;
    const run = await fetchMnRoster(NOVEMBER_2026, new Date(), {
      fetchImpl: async () => bytes(new Uint8Array(++n === 1 ? candBytes : localBytes)),
    });
    expect(run.fromState).toBeGreaterThan(0);
    expect(run.fromLocal).toBeGreaterThan(0);
  });
});
