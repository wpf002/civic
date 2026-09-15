import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseContests, raceKeyForContest, toRosters } from "./google-civic.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const body = JSON.parse(readFileSync(join(here, "google-civic-voterinfo-documented.json"), "utf8"));

describe("voterinfo contests", () => {
  const contests = parseContests(body);

  it("keeps candidate contests and skips referendums", () => {
    expect(contests.map((c) => c.office)).toEqual([
      "U.S. Senate",
      "U.S. House of Representatives - District 15",
      "Governor",
      "Franklin County Commissioner",
    ]);
  });

  it("drops phone and email at the parse boundary", () => {
    const jane = contests[0]!.candidates[0]!;
    expect(Object.keys(jane).sort()).toEqual(["candidateUrl", "channels", "name", "party"]);
    expect(JSON.stringify(contests)).not.toMatch(/555|@example\.org/);
    expect(jane.name).toBe("Jane Example");
  });

  it("keeps only real campaign URLs", () => {
    expect(contests[1]!.candidates[0]!.candidateUrl).toBeNull();
  });

  it("maps races by role, level and district id, never by the office's wording", () => {
    expect(contests.map((c) => raceKeyForContest("OH", c))).toEqual([
      "us-senate-oh",
      "us-house-oh-15",
      "governor-oh",
      null, // a county commission is a legislatorUpperBody too, at a different level
    ]);
  });

  it("marks a contest official only when every source is", () => {
    expect(contests.map((c) => c.official)).toEqual([true, true, false, true]);
  });
});

describe("combining addresses", () => {
  const contests = parseContests(body);

  it("builds one roster per race and reports offices it does not model", () => {
    const run = toRosters("OH", [{ address: "a", contests }], "https://www.googleapis.com/civicinfo/v2/voterinfo", new Date());
    expect(run.rosters.map((r) => r.raceKey)).toEqual(["governor-oh", "us-house-oh-15", "us-senate-oh"]);
    expect(run.rosters.find((r) => r.raceKey === "us-senate-oh")!.entries.map((e) => e.party)).toEqual(["D", "R"]);
    expect(run.unmapped.get("Franklin County Commissioner")).toBe(1);
    // The governor contest came from an unofficial source, so the run is not all-official.
    expect(run.allOfficial).toBe(false);
    expect(run.websites).toEqual([{ raceKey: "us-senate-oh", key: "jane example", url: "https://example.org/jane" }]);
  });

  it("leaves out a race two addresses disagree on, rather than picking one", () => {
    const other = parseContests({
      contests: [{ ...body.contests[0], candidates: [{ name: "Someone Else", party: "Green Party" }] }],
    });
    const run = toRosters("OH", [{ address: "a", contests }, { address: "b", contests: other }], "u", new Date());
    expect(run.conflicts).toEqual(["us-senate-oh"]);
    expect(run.rosters.map((r) => r.raceKey)).not.toContain("us-senate-oh");
  });
});
