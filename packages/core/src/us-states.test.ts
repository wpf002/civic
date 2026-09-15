import { describe, expect, it } from "vitest";
import { US_STATES, congressionalSeat, houseSeatLabel, stateByName } from "./us-states.js";

describe("the 2026 ballot table", () => {
  it("has every state and DC once", () => {
    expect(US_STATES).toHaveLength(51);
    expect(new Set(US_STATES.map((s) => s.code)).size).toBe(51);
    expect(new Set(US_STATES.map((s) => s.fips)).size).toBe(51);
  });

  it("apportions exactly 435 voting House seats", () => {
    const voting = US_STATES.filter((s) => s.code !== "DC");
    expect(voting.reduce((n, s) => n + s.houseSeats, 0)).toBe(435);
  });

  it("puts 35 Senate seats on the ballot: 33 regular and 2 specials", () => {
    expect(US_STATES.filter((s) => s.senate2026 === "Class II")).toHaveLength(33);
    expect(US_STATES.filter((s) => s.senate2026 === "Class III").map((s) => s.code).sort()).toEqual(["FL", "OH"]);
  });

  it("has 36 governor races", () => {
    expect(US_STATES.filter((s) => s.governor2026)).toHaveLength(36);
  });

  it("labels single-seat states and DC without a district number", () => {
    expect(houseSeatLabel("WY", 0)).toBe("At-Large");
    expect(houseSeatLabel("DC", 0)).toBe("Delegate");
    expect(houseSeatLabel("TX", 7)).toBe("District 7");
    expect(stateByName("north carolina")?.code).toBe("NC");
  });
});

describe("an address's House seat", () => {
  it("reads the Census district name for each kind of seat", () => {
    expect(congressionalSeat("TX", "Congressional District 7")).toBe("District 7");
    expect(congressionalSeat("WY", "Congressional District (at Large)")).toBe("At-Large");
    expect(congressionalSeat("DC", "Delegate District (at Large)")).toBe("Delegate");
  });

  it("returns nothing when the name does not fit the state", () => {
    expect(congressionalSeat("WY", "Congressional District 3")).toBeNull();
    expect(congressionalSeat("TX", "Congressional District (at Large)")).toBeNull();
    expect(congressionalSeat("TX", undefined)).toBeNull();
  });
});

describe("state offices", () => {
  it("labels legislative seats with the chamber and the state's own id", async () => {
    const { legislativeSeat, legislativeSeatLabel } = await import("./us-states.js");
    expect(legislativeSeatLabel("upper", "23")).toBe("Senate District 23");
    expect(legislativeSeat("lower", "State House District 45A")).toBe("House District 45A");
    expect(legislativeSeat("upper", "State Senate District 23")).toBe("Senate District 23");
    expect(legislativeSeat("lower", undefined)).toBeNull();
  });

  it("title-cases an office for display and slugs it for a key", async () => {
    const { officeSlug, officeTitleCase } = await import("./us-states.js");
    expect(officeTitleCase("COMPTROLLER OF PUBLIC ACCOUNTS")).toBe("Comptroller of Public Accounts");
    expect(officeTitleCase("JUSTICE, SUPREME COURT, PLACE 2 - UNEXPIRED TERM")).toBe("Justice, Supreme Court, Place 2 - Unexpired Term");
    expect(officeSlug("Justice, Supreme Court, Place 2 - Unexpired Term")).toBe("justice-supreme-court-place-2-unexpired-term");
  });
});
