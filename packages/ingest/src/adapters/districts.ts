/**
 * Address → districts.
 *
 * Free, keyless, and verified end to end. Census resolves the address and the
 * federal/state layers; the city and school district publish their own boundaries as
 * public ArcGIS point queries. No PostGIS, no shapefile pipeline, no vendor.
 *
 * PRIVACY: the address is used to obtain a point and a set of district ids, and is
 * then discarded. Nothing here persists an address, and nothing returns one.
 *
 * THE TRAP THIS FILE EXISTS TO ENCODE. Both Dallas publishers also serve a stale
 * boundary layer under a more inviting name, and a stale layer does not fail — it
 * answers confidently and wrongly. Dallas ISD's `TrusteeDistricts` is
 * `Dallas_ISD___Plan_12_Adopted_Aug_25_2011___BHDA`, the pre-redistricting map:
 * measured against the adopted 2021 plan it puts 14 of 183 sampled points in the
 * wrong trustee race. The two layers that ARE the adopted plan agree on 183 of 183.
 * So the layer identity is pinned here and asserted in tests, and the wrong one is
 * named so nobody reaches for it later.
 */

export interface DistrictResult {
  /** Point the address resolved to. Kept only for the duration of the request. */
  point: { lat: number; lon: number };
  matchedAddress: string;
  state?: string;
  county?: string;
  place?: string;
  congressional?: string;
  stateSenate?: string;
  stateHouse?: string;
  schoolDistrictName?: string;
  /** Dallas City Council. The seat is a "Place" on the ballot, not a "District". */
  dallasCouncilPlace?: string;
  dallasCouncilMember?: string;
  dallasIsdTrusteeDistrict?: string;
  /** Which layer answered what, so a wrong district is traceable to a wrong layer. */
  provenance: Array<{ layer: string; source: string; value: string }>;
}

const CENSUS = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";

/**
 * Pinned layer identities. `expectLayerName` is asserted before a query is trusted:
 * if a publisher swaps what sits behind a service name, we fail loudly rather than
 * silently answering from a different map.
 */
export const LAYERS = {
  dallasCouncil: {
    url: "https://gis.dallascityhall.com/arcgis/rest/services/Basemap/CouncilAreas/MapServer/0",
    field: "DISTRICT",
    memberField: "COUNCILPER",
    // Do NOT use the AGOL "City_of_Dallas_Council_Districts" mirror: 2011 boundaries.
    // Do NOT use CouncilDistrictBorder: a line layer, whose point queries return nothing.
  },
  disdTrustee: {
    url: "https://services.arcgis.com/RfrtTbYxQ8YIhjWT/arcgis/rest/services/DISD_Trustee_SMD_Adopted_Dec_16_2021/FeatureServer/0",
    field: "PLAN_5",
    expectLayerName: "DISD_Trustee_SMD_Adopted_Dec_16_2021",
  },
} as const;

/**
 * Superseded layers that still answer. Named so they are greppable, and asserted
 * against in tests so nobody quietly swaps one in.
 */
export const STALE_LAYERS = {
  disdTrustee2011:
    "https://services.arcgis.com/RfrtTbYxQ8YIhjWT/arcgis/rest/services/TrusteeDistricts/FeatureServer/0",
} as const;

async function arcgisPoint(
  layerUrl: string,
  lon: number,
  lat: number,
): Promise<Record<string, unknown> | null> {
  const qs = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });
  const res = await fetch(`${layerUrl}/query?${qs}`);
  if (!res.ok) throw new Error(`arcgis ${res.status} for ${layerUrl}`);
  const body = (await res.json()) as {
    error?: { message: string };
    features?: Array<{ attributes: Record<string, unknown> }>;
  };
  if (body.error) throw new Error(`arcgis: ${body.error.message}`);
  return body.features?.[0]?.attributes ?? null;
}

/** Assert the service still holds the map we think it does. */
export async function assertLayerIdentity(layerUrl: string, expected: string): Promise<void> {
  const res = await fetch(`${layerUrl}?f=json`);
  if (!res.ok) throw new Error(`arcgis metadata ${res.status} for ${layerUrl}`);
  const meta = (await res.json()) as { name?: string };
  if (meta.name !== expected) {
    throw new Error(
      `layer identity changed: ${layerUrl} is now "${meta.name}", expected "${expected}". ` +
        `Refusing to resolve districts against an unverified boundary map.`,
    );
  }
}

/** The plain string fields on DistrictResult, so assignment stays type-checked. */
type StringField =
  | "state"
  | "county"
  | "place"
  | "congressional"
  | "stateSenate"
  | "stateHouse"
  | "schoolDistrictName"
  | "dallasCouncilPlace"
  | "dallasCouncilMember"
  | "dallasIsdTrusteeDistrict";

const pick = (g: Record<string, Array<Record<string, unknown>>>, key: string, field = "NAME") =>
  (g[key]?.[0]?.[field] as string | undefined) ?? undefined;

export async function resolveDistricts(address: string): Promise<DistrictResult | null> {
  const qs = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    layers: "all",
    format: "json",
  });
  const res = await fetch(`${CENSUS}?${qs}`);
  if (!res.ok) throw new Error(`census geocoder ${res.status}`);
  const body = (await res.json()) as {
    result?: {
      addressMatches?: Array<{
        matchedAddress: string;
        coordinates: { x: number; y: number };
        geographies: Record<string, Array<Record<string, unknown>>>;
      }>;
    };
  };

  const m = body.result?.addressMatches?.[0];
  if (!m) return null;

  const lon = m.coordinates.x;
  const lat = m.coordinates.y;
  const g = m.geographies ?? {};
  const provenance: DistrictResult["provenance"] = [];

  const out: DistrictResult = {
    point: { lat, lon },
    matchedAddress: m.matchedAddress,
    provenance,
  };

  /** Assign a named string field and record which layer produced it. */
  const set = (key: StringField, layer: string, v: string | undefined) => {
    if (!v) return;
    out[key] = v;
    provenance.push({ layer, source: "census-geocoder", value: v });
  };

  set("state", "States", pick(g, "States"));
  set("county", "Counties", pick(g, "Counties"));
  set("place", "Incorporated Places", pick(g, "Incorporated Places"));
  set("schoolDistrictName", "Unified School Districts", pick(g, "Unified School Districts"));
  // Census names these by congress/redistricting cycle, so match on prefix.
  const cyclical: Array<[StringField, string]> = [
    ["congressional", "th Congressional Districts"],
    ["stateSenate", "State Legislative Districts - Upper"],
    ["stateHouse", "State Legislative Districts - Lower"],
  ];
  for (const [key, prefix] of cyclical) {
    const layer = Object.keys(g).find((k) => k.includes(prefix));
    if (layer) set(key, layer, pick(g, layer));
  }

  // Local layers, only where they apply. A failure here is not fatal to the federal
  // and state answers, but it must be visible rather than rendering as "no district".
  if (out.place === "Dallas city") {
    const a = await arcgisPoint(LAYERS.dallasCouncil.url, lon, lat);
    const v = a?.[LAYERS.dallasCouncil.field];
    if (v != null) {
      out.dallasCouncilPlace = String(v);
      const member = a?.[LAYERS.dallasCouncil.memberField];
      if (member) out.dallasCouncilMember = String(member);
      provenance.push({ layer: "CouncilAreas", source: LAYERS.dallasCouncil.url, value: String(v) });
    }
  }

  if (out.schoolDistrictName?.includes("Dallas Independent")) {
    const a = await arcgisPoint(LAYERS.disdTrustee.url, lon, lat);
    const v = a?.[LAYERS.disdTrustee.field];
    if (v != null) {
      out.dallasIsdTrusteeDistrict = String(v);
      provenance.push({
        layer: LAYERS.disdTrustee.expectLayerName,
        source: LAYERS.disdTrustee.url,
        value: String(v),
      });
    }
  }

  return out;
}
