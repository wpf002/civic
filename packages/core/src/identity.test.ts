import { describe, expect, it } from "vitest";
import { parseName, proposePairsInRace, proposeSamePerson } from "./identity.js";

describe("the pairs that actually appeared in the Texas data", () => {
  it.each([
    ["Sylvia Garcia", "Sylvia R Garcia", "strong"],
    ["Steven Shook", "Steven James Shook", "strong"],
    ["Melissa McDonough", "Melissa A McDonough", "strong"],
    ["William Miskey Taggart IV", "William M Taggart IV", "strong"],
    ["Nathaniel Moran", "Nathaniel Quentin Moran", "strong"],
    ["Yolanda R. Prince", "Yolanda Rena Prince", "strong"],
  ])("%s / %s -> %s", (a, b, confidence) => {
    expect(proposeSamePerson(a, b)?.confidence).toBe(confidence);
  });

  it("does NOT pair two people who share only a generational suffix", () => {
    // A naive last-token comparison paired these on "Jr." — they are two candidates
    // in the same race and merging them would delete one.
    expect(proposeSamePerson("Alfredo Hinojosa Jr.", "Gregory Scott Kunkle Jr.")).toBeNull();
  });

  it("does NOT pair relatives who share a surname in one race", () => {
    expect(proposeSamePerson("Mayra Nohemi Flores", "Eric Flores")).toBeNull();
  });
});

describe("things that must never merge", () => {
  it("keeps Jr and Sr apart — they run against each other", () => {
    expect(proposeSamePerson("Robert King Jr", "Robert King Sr")).toBeNull();
    expect(proposeSamePerson("Robert King", "Robert King Jr")).toBeNull();
    expect(proposeSamePerson("Robert King III", "Robert King II")).toBeNull();
  });

  it("keeps different middle names apart", () => {
    // Not an omission and not an initial: two different stated middle names.
    expect(proposeSamePerson("James Allen Smith", "James Robert Smith")).toBeNull();
  });

  it("keeps different surnames apart however similar", () => {
    expect(proposeSamePerson("Marc Russouw", "Marc Rossouw")).toBeNull();
  });
});

describe("weaker proposals, marked as such", () => {
  it("proposes a known nickname but does not call it strong", () => {
    expect(proposeSamePerson("Bill Roth", "William Roth")).toMatchObject({ confidence: "possible" });
    expect(proposeSamePerson("Jeff Kitner", "Jeffrey Kitner")).toMatchObject({ confidence: "possible" });
  });

  it("proposes an initial against a name, as possible", () => {
    expect(proposeSamePerson("J Smith", "James Smith")).toMatchObject({ confidence: "possible" });
  });
});

describe("name parsing", () => {
  it("splits the suffix off before reading the surname", () => {
    expect(parseName("William Miskey Taggart IV")).toEqual({
      first: "william", middles: ["miskey"], last: "taggart", suffix: "iv",
    });
  });

  it("survives a single-token name without inventing parts", () => {
    expect(parseName("Cher")).toEqual({ first: "", middles: [], last: "cher", suffix: null });
    expect(proposeSamePerson("Cher", "Cher")).toBeNull(); // no first name to compare
  });
});

describe("pairing within a race", () => {
  it("returns each pair once and never pairs a record with itself", () => {
    const pairs = proposePairsInRace([
      { id: "1", fullName: "Sylvia Garcia" },
      { id: "2", fullName: "Sylvia R Garcia" },
      { id: "3", fullName: "Eric Flores" },
    ]);
    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.a.id, pairs[0]!.b.id]).toEqual(["1", "2"]);
  });
});
