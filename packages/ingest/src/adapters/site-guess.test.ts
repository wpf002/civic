import { describe, expect, it } from "vitest";
import { candidateDomains, isNeverACandidateSite, nameParts, provesCandidate } from "./site-guess.js";

const OPTS = { fullName: "Alexandra Mealer", state: "TX", office: "United States Representative" };
const campaign =
  "Alexandra Mealer is running for Congress in Texas District 9. Paid for by Mealer for Congress. ".repeat(4);

describe("building candidate domains", () => {
  it("drops honorifics and suffixes from the name", () => {
    expect(nameParts("Frederick D. Haynes III")).toEqual({ first: "frederick", last: "haynes" });
    expect(nameParts('Robert "Bob" Smith Jr.')).toEqual({ first: "robert", last: "smith" });
  });

  it("puts the likeliest domains first, so most are never fetched", () => {
    const d = candidateDomains(OPTS);
    expect(d[0]).toBe("alexandramealer.com");
    expect(d).toContain("mealerforcongress.com");
    expect(d).toContain("votemealer.com");
  });

  it("uses senate rather than congress for a senate race", () => {
    const d = candidateDomains({ ...OPTS, office: "United States Senator" });
    expect(d).toContain("mealerforsenate.com");
  });

  it("returns nothing for a name it cannot split", () => {
    expect(candidateDomains({ ...OPTS, fullName: "" })).toEqual([]);
  });
});

describe("the proof, which is what makes guessing safe", () => {
  it("accepts a page that names the candidate, the office, and is a campaign", () => {
    expect(provesCandidate(campaign, "", OPTS).accepted).toBe(true);
  });

  it("refuses a page that names someone else with the same surname", () => {
    // A guessed URL that fails the proof is discarded, which is the same outcome as
    // never guessing it. This is the difference from taking a search result.
    const other = "Dr. Susan Mealer is a dentist in Houston, Texas. Book an appointment. ".repeat(5);
    expect(provesCandidate(other, "", OPTS).accepted).toBe(false);
  });

  it("refuses a parked or for-sale domain", () => {
    const parked = "alexandramealer.com. This domain is for sale. Related searches. ".repeat(6);
    expect(provesCandidate(parked, "", OPTS).why).toMatch(/parked or for-sale/);
  });

  it("refuses a personal site with the right name and no campaign", () => {
    const personal = "Alexandra Mealer. Photographer based in Texas. Portfolio and prints. ".repeat(6);
    expect(provesCandidate(personal, "", OPTS).why).toMatch(/is not a campaign/);
  });

  it("refuses a nearly empty page", () => {
    expect(provesCandidate("Alexandra Mealer", "", OPTS).why).toMatch(/almost no text/);
  });

  it("requires both names, so a surname alone is not enough", () => {
    const surnameOnly = "Mealer for Congress in Texas District 9. Paid for by the campaign. ".repeat(5);
    expect(provesCandidate(surnameOnly, "", OPTS).accepted).toBe(false);
  });
});

describe("hosts that are never a candidate's own site", () => {
  it.each([
    "https://ballotpedia.org/Alexandra_Mealer",
    "https://en.wikipedia.org/wiki/X",
    "https://www.facebook.com/x",
    "https://secure.actblue.com/x",
    "https://www.hugedomains.com/domain_profile.cfm",
  ])("%s", (u) => expect(isNeverACandidateSite(u)).toBe(true));

  it("allows an ordinary campaign domain", () => {
    expect(isNeverACandidateSite("https://mealerforcongress.com/")).toBe(false);
  });
});

describe("state offices and states other than Texas", () => {
  it("guesses domains for the office the candidate is running for", async () => {
    const { candidateDomains } = await import("./site-guess.js");
    const rep = candidateDomains({ fullName: "Maggy Krell", state: "CA", office: "State Representative" });
    expect(rep).toContain("krellforassembly.com");
    expect(rep.some((d) => d.includes("congress"))).toBe(false);
    expect(candidateDomains({ fullName: "Byron Donalds", state: "FL", office: "Governor" })).toContain("donaldsforgovernor.com");
  });

  it("proves jurisdiction by the state's name, not its two-letter code", async () => {
    const { provesCandidate } = await import("./site-guess.js");
    // "ca" is inside "campaign"; the old check passed any page for any California candidate.
    const page =
      "Jane Example campaign. Paid for by Jane Example. " +
      "A local bakery with a long history of great cakes and a friendly staff who love their town. ".repeat(3);
    expect(provesCandidate(page, "", { fullName: "Jane Example", state: "CA", office: "State Senator" }).accepted).toBe(false);
    expect(
      provesCandidate(page + " Running for State Senate in California.", "", { fullName: "Jane Example", state: "CA", office: "State Senator" }).accepted,
    ).toBe(true);
  });
});
