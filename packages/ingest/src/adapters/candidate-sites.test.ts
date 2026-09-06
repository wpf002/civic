import { describe, expect, it } from "vitest";
import {
  fetchFecSites,
  normalizeFiledUrl,
  preferSite,
  siteFromCongressMember,
  siteFromFecCommittees,
  siteFromOpenStatesLinks,
} from "./candidate-sites.js";

describe("URLs as typed into a government form", () => {
  it.each([
    // Every one of these is a real Texas 2026 committee filing.
    ["WWW.ABEL4CONGRESS.COM", "https://www.abel4congress.com"],
    ["DAXFORCONGRESS.COM", "https://daxforcongress.com"],
    ["WWW.BABINFORCONGRESS.COM/", "https://www.babinforcongress.com"],
    ["https://ajlouderback.com/", "https://ajlouderback.com"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeFiledUrl(raw)).toBe(expected);
  });

  it("refuses what people type into a website box that is not a website", () => {
    // Repairing these would produce a URL that resolves somewhere. None of these
    // is worth guessing at: an empty websiteUrl is true, a wrong one is a liability.
    for (const junk of ["", "  ", "N/A", "none", "TBD", "pending", "same", "candidate@example.com", "localhost", "127.0.0.1"]) {
      expect(normalizeFiledUrl(junk)).toBeNull();
    }
    expect(normalizeFiledUrl(null)).toBeNull();
  });
});

describe("FEC committee filings", () => {
  it("takes the website from the principal committee only", () => {
    const site = siteFromFecCommittees(
      [
        // A joint fundraising committee's URL belongs to a different organisation.
        { designation: "J", website: "WWW.SOMEJOINTPAC.COM", name: "JOINT PAC" },
        { designation: "P", website: "CHELSEYHOCKETTFORCONGRESS.COM", name: "CHELSEY HOCKETT FOR CONGRESS" },
      ],
      "H6TX05189",
    );
    expect(site).toMatchObject({ url: "https://chelseyhockettforcongress.com", kind: "CAMPAIGN" });
    expect(site!.assertedByUrl).toContain("H6TX05189");
  });

  it("returns nothing rather than falling back to a non-principal committee", () => {
    expect(siteFromFecCommittees([{ designation: "J", website: "WWW.PAC.COM" }], "H1")).toBeNull();
    expect(siteFromFecCommittees([{ designation: "P", website: null }], "H1")).toBeNull();
    expect(siteFromFecCommittees([], "H1")).toBeNull();
  });
});

describe("OpenStates link lists", () => {
  // The real link list for A.J. Louderback, TX House District 30.
  const links = [
    { url: "https://ajlouderback.com/" },
    { url: "https://house.texas.gov/members/4620" },
    { url: "https://ballotpedia.org/A.J._Louderback" },
    { url: "https://en.wikipedia.org/wiki/AJ_Louderback" },
    { url: "https://www.linkedin.com/in/aj-louderback-b8bb4812a" },
  ];

  it("picks the campaign site over the chamber page and the encyclopedias", () => {
    const site = siteFromOpenStatesLinks(links, "https://openstates.org/person/x/");
    expect(site).toMatchObject({ url: "https://ajlouderback.com", kind: "CAMPAIGN" });
  });

  it("never returns Ballotpedia, Wikipedia, VoteSmart, LinkedIn or a donation host", () => {
    const onlyThirdParty = [
      { url: "https://ballotpedia.org/Someone" },
      { url: "https://en.wikipedia.org/wiki/Someone" },
      { url: "https://justfacts.votesmart.org/candidate/biography/1/someone" },
      { url: "https://secure.actblue.com/donate/someone" },
      { url: "https://winred.com/someone" },
    ];
    expect(siteFromOpenStatesLinks(onlyThirdParty, "p")).toBeNull();
  });

  it("falls back to the chamber page but labels it OFFICIAL, not CAMPAIGN", () => {
    const site = siteFromOpenStatesLinks([{ url: "https://house.texas.gov/members/4620" }], "p");
    expect(site).toMatchObject({ kind: "OFFICIAL" });
  });
});

describe("choosing between sites", () => {
  const campaign = { url: "https://x.com/a", kind: "CAMPAIGN" as const, assertedBy: "", assertedByUrl: "" };
  const official = { url: "https://y.house.gov", kind: "OFFICIAL" as const, assertedBy: "", assertedByUrl: "" };

  it("prefers what a candidate says they will do over what an officeholder has done", () => {
    expect(preferSite(official, campaign)).toBe(campaign);
    expect(preferSite(campaign, official)).toBe(campaign);
    expect(preferSite(null, official)).toBe(official);
    expect(preferSite(null, null)).toBeNull();
  });

  it("marks a .house.gov site OFFICIAL, because franked content is not campaign speech", () => {
    const s = siteFromCongressMember({ officialWebsiteUrl: "http://menefee.house.gov/", bioguideId: "M001245" });
    // Congress.gov really does return http:// here. The scheme is left as asserted
    // rather than upgraded: rewriting a URL someone stated is the same class of
    // "helpful repair" that turns a missing site into a confidently wrong one. The
    // fetch follows the redirect and the archived Source records where it landed.
    expect(s).toMatchObject({ url: "http://menefee.house.gov", kind: "OFFICIAL" });
  });
});

describe("fetching committee sites", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  it("retries a rate limit instead of recording the candidate as having no site", async () => {
    // The first run of this reported 52 of 245 when the real rate was near half:
    // every 429 was being counted as "no website".
    let n = 0;
    const { sites, failed } = await fetchFecSites(["A"], {
      apiKey: "k",
      concurrency: 1,
      sleep: async () => {},
      fetchImpl: async () => {
        n++;
        if (n < 3) return { ok: false, status: 429 } as Response;
        return ok({ results: [{ designation: "P", website: "A4CONGRESS.COM" }] });
      },
    });
    expect(sites.get("A")?.url).toBe("https://a4congress.com");
    expect(failed).toEqual([]);
  });

  it("reports a lookup it could never complete as failed, not as an absence", async () => {
    const { sites, failed } = await fetchFecSites(["A", "B"], {
      apiKey: "k",
      concurrency: 1,
      retries: 1,
      sleep: async () => {},
      fetchImpl: async (u) =>
        String(u).includes("/A/")
          ? ({ ok: false, status: 429 } as Response)
          : ok({ results: [{ designation: "P", website: "B4CONGRESS.COM" }] }),
    });
    expect([...sites.keys()]).toEqual(["B"]);
    expect(failed).toEqual(["A"]);
  });

  it("treats a real 404 as this candidate having no committee, without retrying", async () => {
    let calls = 0;
    const { sites, failed } = await fetchFecSites(["A"], {
      apiKey: "k",
      concurrency: 1,
      sleep: async () => {},
      fetchImpl: async () => {
        calls++;
        return { ok: false, status: 404 } as Response;
      },
    });
    expect(calls).toBe(1);
    expect(sites.size).toBe(0);
    expect(failed).toEqual([]);
  });

  it("says how to get a key when none is set", async () => {
    await expect(fetchFecSites(["A"], { apiKey: "", fetchImpl: async () => ok({}) })).rejects.toThrow(
      /api\.data\.gov\/signup/,
    );
  });
});
