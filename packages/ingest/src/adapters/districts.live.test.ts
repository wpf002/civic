import { describe, expect, it } from "vitest";
import { LAYERS, STALE_LAYERS, assertLayerIdentity, resolveDistricts } from "./districts.js";

/**
 * These hit live public endpoints. They are the regression that catches a publisher
 * swapping a boundary layer — the failure mode that answers confidently and wrongly.
 * Skipped unless CIVIC_LIVE=1 so CI stays hermetic.
 */
const live = process.env.CIVIC_LIVE === "1" ? describe : describe.skip;

live("address → districts (live)", () => {
  it("resolves Dallas City Hall to federal, state, council and trustee districts", async () => {
    const r = await resolveDistricts("1500 Marilla St, Dallas, TX 75201");
    expect(r).not.toBeNull();
    expect(r!.state).toBe("Texas");
    expect(r!.county).toBe("Dallas County");
    expect(r!.place).toBe("Dallas city");
    expect(r!.schoolDistrictName).toContain("Dallas Independent");
    expect(r!.congressional).toBeTruthy();
    expect(r!.stateSenate).toBeTruthy();
    expect(r!.stateHouse).toBeTruthy();
    // The two layers Census cannot give us, and which are the pilot's entire content.
    expect(r!.dallasCouncilPlace).toBeTruthy();
    expect(r!.dallasIsdTrusteeDistrict).toBeTruthy();
    // Every district must be attributable to the layer that produced it.
    expect(r!.provenance.length).toBeGreaterThanOrEqual(6);
  }, 60_000);

  it("still holds the boundary maps we pinned", async () => {
    await expect(
      assertLayerIdentity(LAYERS.disdTrustee.url, LAYERS.disdTrustee.expectLayerName),
    ).resolves.toBeUndefined();
  }, 30_000);

  it("refuses a layer whose identity has changed", async () => {
    await expect(
      assertLayerIdentity(LAYERS.disdTrustee.url, "Some_Other_Plan"),
    ).rejects.toThrow(/layer identity changed/);
  }, 30_000);

  // The decoy. Its service name is the inviting one; its layer is the 2011 map.
  it("documents that the stale DISD layer is the superseded 2011 plan", async () => {
    const meta = await (await fetch(`${STALE_LAYERS.disdTrustee2011}?f=json`)).json();
    expect(meta.name).toMatch(/2011/);
    expect(meta.name).not.toBe(LAYERS.disdTrustee.expectLayerName);
  }, 30_000);
});
