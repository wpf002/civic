import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  billKey,
  fetchMemberVotes,
  fetchRollCalls,
  parseMemberVotes,
  parseRollCalls,
} from "./congress-votes.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const memberBody = JSON.parse(readFileSync(join(here, "congress-rollcall-119-2-100.json"), "utf8"));
const listBody = JSON.parse(readFileSync(join(here, "congress-votes-119-2.json"), "utf8"));

describe("reading a real roll call", () => {
  const votes = parseMemberVotes(memberBody);

  it("records every member's vote as the Clerk recorded it", () => {
    expect(votes.length).toBe(432);
    const tx = votes.filter((v) => v.state === "TX");
    expect(tx.length).toBe(38);
    // Not Voting is a real value and is kept. Dropping it would turn an absence into
    // a silence, and the two are different facts about a member.
    expect(new Set(tx.map((v) => v.voteCast))).toEqual(new Set(["Yea", "Nay", "Not Voting"]));
  });

  it("keeps the bioguide id, which is how a vote joins to a candidate", () => {
    for (const v of votes) expect(v.bioguideId).toMatch(/^[A-Z]\d{6}$/);
  });

  it("does not interpret the vote", () => {
    // This file records facts. Whether a Yea agrees with a proposition is decided
    // once per bill, elsewhere, and reviewed.
    const src = readFileSync(join(here, "..", "congress-votes.ts"), "utf8");
    expect(src).not.toMatch(/SUPPORT|OPPOSE|stance/);
  });
});

describe("reading the roll call list", () => {
  const list = parseRollCalls(listBody);

  it("carries the bill and the Clerk's own record", () => {
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]!.rollCallNumber).toBeGreaterThan(0);
    expect(list[0]!.sourceDataUrl).toMatch(/clerk\.house\.gov/);
  });

  it("keys a vote by its bill, so one bill's meaning is decided once", () => {
    expect(billKey({ legislationType: "HR", legislationNumber: "5103" })).toBe("HR 5103");
    expect(billKey({ legislationType: null, legislationNumber: "5103" })).toBeNull();
  });

  it("returns nothing rather than guessing when the shape changes", () => {
    expect(parseRollCalls({ somethingElse: [] })).toEqual([]);
    expect(parseMemberVotes({})).toEqual([]);
  });
});

describe("fetching", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  it("refuses a short member list rather than reporting members who did not vote", async () => {
    const short = {
      houseRollCallVoteMemberVotes: { results: memberBody.houseRollCallVoteMemberVotes.results.slice(0, 12) },
    };
    await expect(
      fetchMemberVotes(119, 2, 100, { apiKey: "k", sleep: async () => {}, fetchImpl: async () => ok(short) }),
    ).rejects.toThrow(/indistinguishable from members not voting/);
  });

  it("retries a rate limit instead of losing the vote", async () => {
    let n = 0;
    const votes = await fetchMemberVotes(119, 2, 100, {
      apiKey: "k",
      sleep: async () => {},
      fetchImpl: async () => (++n < 3 ? ({ ok: false, status: 429 } as Response) : ok(memberBody)),
    });
    expect(votes.length).toBe(432);
  });

  it("never puts the API key in an error message", async () => {
    await expect(
      fetchRollCalls(119, 2, {
        apiKey: "secret-key-value",
        sleep: async () => {},
        fetchImpl: async () => ({ ok: false, status: 404 } as Response),
      }),
    ).rejects.toThrow(/api_key=\*\*\*/);
  });

  it("says how to get a key when none is set", async () => {
    await expect(
      fetchRollCalls(119, 2, { apiKey: "", fetchImpl: async () => ok({}) }),
    ).rejects.toThrow(/api\.congress\.gov\/sign-up/);
  });
});
