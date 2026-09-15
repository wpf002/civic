/**
 * Enacted district plans, as block assignment files.
 *
 * The Census geocoder serves the 119th Congress's districts. Ten states drew new
 * congressional maps for 2026 after that layer was made, so for them the geocoder
 * names the wrong House seat. Dallas City Hall is District 30 on the Census layer
 * and District 33 on the plan Texas actually enacted for 2026 (PLANC2333).
 *
 * Every enacting body publishes its plan as a block assignment file: one row per
 * 2020 census block, naming the district. The geocoder already returns the block,
 * so the lookup is exact and needs no geometry.
 *
 * A plan is registered here by hand, with the enacting body's own file, and never
 * discovered by search. A wrong plan puts every voter in a state in the wrong race.
 *
 * Enacted is not the same as in force. Missouri enacted HB 1 in September 2025 and
 * held its August 2026 primary on it. On September 3 2026 the Supreme Court of
 * Missouri barred it until a referendum is held; a federal restraining order revived
 * it, the US Supreme Court stayed that order on September 10, and the Secretary of
 * State then directed counties to use the 2022 map, which is the Census layer. It is
 * deliberately absent here. Check
 * every plan's status again before an election, not only when it is added.
 */
import { createHash } from "node:crypto";
import { bbox, stateByCode, type Polygon } from "@civic/core";
import { readXlsx, readZip } from "../xlsx.js";

export type PlanSource =
  /** A block assignment file: the exact answer, and the common case. */
  | { kind: "blocks"; url: string; zipMember?: RegExp; format?: "csv" | "xlsx" }
  /** Boundaries only, as a zipped shapefile in WGS84. */
  | { kind: "shapefile"; url: string; shpMember: RegExp; districtField: string }
  /** Boundaries only, from the state's own GIS office as an ArcGIS feature layer. */
  | { kind: "arcgis"; layerUrl: string; districtField: string }
  /**
   * A plan in force that cannot be looked up from anything published. Registered
   * anyway: its presence stops the out-of-date Census layer from answering for the
   * state, so a voter is told their district is unknown instead of shown the wrong one.
   */
  | { kind: "unresolvable"; reason: string };

export interface KnownPlan {
  state: string;
  chamber: "CONGRESS" | "STATE_UPPER" | "STATE_LOWER";
  name: string;
  /** Day from which the plan answers. Lookups use the newest plan in force on election day. */
  firstElection: string;
  source: PlanSource;
}

export const KNOWN_PLANS: readonly KnownPlan[] = [
  {
    // Enacted August 29 2025. Blocked by a district court in November, stayed by the
    // US Supreme Court in December 2025.
    state: "TX",
    chamber: "CONGRESS",
    name: "PLANC2333",
    firstElection: "2026-03-03",
    source: {
      kind: "blocks",
      url: "https://data.capitol.texas.gov/dataset/748c952b-e926-4f44-8d01-a738884b3ec8/resource/bc1ad997-3d59-40f7-8d7f-72a74bb4a5e4/download/planc2333_blk.zip",
      zipMember: /PLANC2333\.csv$/i,
    },
  },
  {
    // Session Law 2025-95 (Senate Bill 249), enacted October 22 2025; a federal panel
    // allowed its use on November 26 2025.
    state: "NC",
    chamber: "CONGRESS",
    name: "SL 2025-95",
    firstElection: "2026-03-03",
    source: {
      kind: "blocks",
      url: "https://webservices.ncleg.gov/ViewBillDocument/2025/7669/0/SL%202025-95%20-%20Block%20Assignment%20File",
      zipMember: /SL 2025-95\.csv$/i,
    },
  },
  {
    // AB 604, chaptered August 21 2025 and put into effect by Proposition 50.
    state: "CA",
    chamber: "CONGRESS",
    name: "AB 604",
    firstElection: "2026-06-02",
    source: { kind: "blocks", url: "https://aelc.assembly.ca.gov/media/2609" },
  },
  {
    // Transmitted by the Governor April 27 2026, passed April 29, signed May 4.
    state: "FL",
    chamber: "CONGRESS",
    name: "EOGPCRP2026",
    firstElection: "2026-08-18",
    source: { kind: "blocks", url: "https://www.flsenate.gov/PublishedContent/Session/Congressional/EOGPCRP2026.txt" },
  },
  {
    // Act 2 of the 2026 Regular Session (SB 121), enacted May 29 2026 after Callais.
    state: "LA",
    chamber: "CONGRESS",
    name: "Act 2 (2026 RS)",
    firstElection: "2026-11-03",
    source: {
      kind: "blocks",
      url: "https://redist.legis.la.gov/2026_Files/Act2Congress/Block%20Equivalency%20File/Block%20Equlivancy%20File%20-%20Act%202%20(2026%20RS%20-%20Congress).txt",
    },
  },
  {
    // Adopted unanimously by the Ohio Redistricting Commission October 31 2025.
    // Published by OGRIP, the state's GIS office.
    state: "OH",
    chamber: "CONGRESS",
    name: "ORC 2025-10-31",
    firstElection: "2026-05-05",
    source: {
      kind: "arcgis",
      layerUrl: "https://maps.ohio.gov/arcgis/rest/services/Hosted/Districts_2025_11_03_SHP/FeatureServer/0",
      districtField: "district",
    },
  },
  {
    // Map 1A, ordered by the Third Judicial District Court November 10 2025.
    // Published by UGRC, the state's GIS office.
    state: "UT",
    chamber: "CONGRESS",
    name: "Map 1A",
    firstElection: "2026-06-23",
    source: {
      kind: "arcgis",
      layerUrl: "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/political_us_congress_districts_2026_to_2032/FeatureServer/0",
      districtField: "DISTRICT",
    },
  },
  {
    // Enacted May 7 2026 in the Second Extraordinary Session. The Comptroller publishes
    // boundaries only.
    state: "TN",
    chamber: "CONGRESS",
    name: "2026 Second Extraordinary Session",
    firstElection: "2026-08-06",
    source: {
      kind: "shapefile",
      url: "https://comptroller.tn.gov/content/dam/cot/pa/documents/district-maps/congress-districts/NewCongressional26.zip",
      shpMember: /NewCongressional26\.(shp|dbf)$/i,
      districtField: "DISTRICT",
    },
  },
  {
    // Livingston Congressional Plan 3-2023, allowed by the US Supreme Court June 2 2026.
    state: "AL",
    chamber: "CONGRESS",
    name: "Livingston Congressional Plan 3-2023",
    firstElection: "2026-08-11",
    source: {
      kind: "unresolvable",
      reason:
        "The Legislature publishes this plan only as a PDF map and a legal description, and no state GIS office publishes its boundaries.",
    },
  },
];

export interface Assignment {
  block: string;
  district: string;
}

/**
 * Read a block assignment CSV.
 *
 * Formats differ by state in the header and the quoting, never in the substance:
 * a 15-digit block GEOID and a district. Rows whose district is blank or a
 * placeholder (water blocks are often "ZZ") are skipped, because a block no one
 * lives in is not a lookup anyone makes. Anything else malformed throws: a plan
 * that half-parses assigns half a state.
 */
export function parseBlockAssignments(csv: string): Assignment[] {
  const out: Assignment[] = [];
  // Several states save with a byte-order mark, which would hide the first block.
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const [rawBlock = "", rawDistrict = ""] = line.split(/\s*[,|\t]\s*|\s+/).map((c) => c.replace(/"/g, "").trim());
    if (i === 0 && !/^\d{15}$/.test(rawBlock)) continue; // header
    if (!/^\d{15}$/.test(rawBlock)) {
      throw new Error(`line ${i + 1}: "${rawBlock}" is not a 15-digit census block`);
    }
    if (!rawDistrict || /^Z+$/i.test(rawDistrict)) continue;
    if (!/^\d{1,3}$/.test(rawDistrict)) {
      throw new Error(`line ${i + 1}: district "${rawDistrict}" is not a number`);
    }
    out.push({ block: rawBlock, district: String(Number(rawDistrict)) });
  }
  return out;
}

export interface DistrictBoundary {
  district: string;
  polygons: Polygon[];
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface FetchedPlan {
  plan: KnownPlan;
  lookup: "BLOCKS" | "SHAPES" | "UNRESOLVABLE";
  assignments: Assignment[];
  shapes: DistrictBoundary[];
  sourceUrl: string;
  sourceHash: string;
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

export async function fetchPlan(plan: KnownPlan, fetchImpl: typeof fetch = fetch): Promise<FetchedPlan> {
  const src = plan.source;
  const base = { plan, assignments: [] as Assignment[], shapes: [] as DistrictBoundary[] };

  if (src.kind === "unresolvable") {
    return { ...base, lookup: "UNRESOLVABLE", sourceUrl: "", sourceHash: sha(src.reason) };
  }

  if (src.kind === "arcgis") {
    const url = `${src.layerUrl}/query?where=1%3D1&outFields=${encodeURIComponent(src.districtField)}&outSR=4326&f=geojson`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`${plan.name}: layer query returned ${res.status}`);
    const text = await res.text();
    const shapes = geojsonToBoundaries(JSON.parse(text), src.districtField);
    checkDistrictCount(plan, shapes.map((s) => s.district));
    return { ...base, lookup: "SHAPES", shapes, sourceUrl: src.layerUrl, sourceHash: sha(text) };
  }

  const res = await fetchImpl(src.url);
  if (!res.ok) throw new Error(`${plan.name}: download returned ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  if (src.kind === "shapefile") {
    const entries = readZip(buf).filter((e) => src.shpMember.test(e.name));
    const shp = entries.find((e) => /\.shp$/i.test(e.name));
    const dbf = entries.find((e) => /\.dbf$/i.test(e.name));
    if (!shp || !dbf) throw new Error(`${plan.name}: the zip has no .shp and .dbf matching ${src.shpMember}`);
    const shapes = shapefileToBoundaries(shp.data, dbf.data, src.districtField);
    checkDistrictCount(plan, shapes.map((s) => s.district));
    return { ...base, lookup: "SHAPES", shapes, sourceUrl: src.url, sourceHash: sha(buf) };
  }

  let csv: string;
  if (src.zipMember) {
    const member = readZip(buf).find((e) => src.zipMember!.test(e.name));
    if (!member) throw new Error(`${plan.name}: no member matching ${src.zipMember} in the zip`);
    csv = member.data.toString("utf8");
  } else if (src.format === "xlsx") {
    csv = readXlsx(buf).map((r) => `${r[0] ?? ""},${r[1] ?? ""}`).join("\n");
  } else {
    csv = buf.toString("utf8");
  }
  const assignments = parseBlockAssignments(csv);
  if (assignments.length === 0) throw new Error(`${plan.name}: no assignments parsed`);
  // Every block in a state starts with that state's FIPS code. A file for the wrong
  // state fails here instead of quietly answering nobody's lookups.
  const fips = stateByCode(plan.state)?.fips;
  const foreign = assignments.find((a) => !a.block.startsWith(fips ?? "--"));
  if (foreign) throw new Error(`${plan.name}: block ${foreign.block} is not in ${plan.state}`);
  checkDistrictCount(plan, assignments.map((a) => a.district));
  return { ...base, lookup: "BLOCKS", assignments, sourceUrl: src.url, sourceHash: sha(buf) };
}

/** A congressional plan must number exactly the state's apportioned seats, 1..n. */
function checkDistrictCount(plan: KnownPlan, districts: string[]) {
  if (plan.chamber !== "CONGRESS") return;
  const seats = stateByCode(plan.state)?.houseSeats ?? 0;
  const found = [...new Set(districts)].map(Number).sort((a, b) => a - b);
  const expected = Array.from({ length: seats }, (_, i) => i + 1);
  if (found.join(",") !== expected.join(",")) {
    throw new Error(`${plan.name}: districts ${found.join(",")} do not match ${plan.state}'s ${seats} seats`);
  }
}

interface GeoJsonFeature {
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: Polygon } | { type: "MultiPolygon"; coordinates: Polygon[] } | null;
}

export function geojsonToBoundaries(fc: { features?: GeoJsonFeature[] }, districtField: string): DistrictBoundary[] {
  const byDistrict = new Map<string, Polygon[]>();
  for (const f of fc.features ?? []) {
    const d = f.properties?.[districtField];
    if (d == null || !f.geometry) continue;
    const key = String(Number(d));
    const list = byDistrict.get(key) ?? [];
    if (f.geometry.type === "Polygon") list.push(f.geometry.coordinates);
    else list.push(...f.geometry.coordinates);
    byDistrict.set(key, list);
  }
  return [...byDistrict.entries()].map(([district, polygons]) => ({ district, polygons, ...bbox(polygons) }));
}

/**
 * Read polygons and one attribute from a shapefile.
 *
 * Only what a district file uses: polygon records (type 5) and a dBase table. Every
 * ring of a record goes into one polygon, and the even-odd test in core/geo sorts
 * out which rings are holes.
 */
export function shapefileToBoundaries(shp: Buffer, dbf: Buffer, districtField: string): DistrictBoundary[] {
  const values = readDbfColumn(dbf, districtField);
  const byDistrict = new Map<string, Polygon[]>();
  let offset = 100;
  let record = 0;
  while (offset + 8 <= shp.length) {
    const contentBytes = shp.readInt32BE(offset + 4) * 2;
    const at = offset + 8;
    const type = shp.readInt32LE(at);
    if (type === 5) {
      const numParts = shp.readInt32LE(at + 36);
      const numPoints = shp.readInt32LE(at + 40);
      const parts = Array.from({ length: numParts }, (_, i) => shp.readInt32LE(at + 44 + i * 4));
      const pointsAt = at + 44 + numParts * 4;
      const polygon: Polygon = parts.map((start, i) => {
        const end = i + 1 < numParts ? parts[i + 1]! : numPoints;
        const ring: Array<[number, number]> = [];
        for (let k = start; k < end; k++) {
          ring.push([shp.readDoubleLE(pointsAt + k * 16), shp.readDoubleLE(pointsAt + k * 16 + 8)]);
        }
        return ring;
      });
      const d = values[record];
      if (d != null && d !== "") {
        const key = String(Number(d));
        const list = byDistrict.get(key) ?? [];
        list.push(polygon);
        byDistrict.set(key, list);
      }
    } else if (type !== 0) {
      throw new Error(`shape type ${type} is not a polygon`);
    }
    record++;
    offset = at + contentBytes;
  }
  return [...byDistrict.entries()].map(([district, polygons]) => ({ district, polygons, ...bbox(polygons) }));
}

function readDbfColumn(dbf: Buffer, field: string): string[] {
  const count = dbf.readUInt32LE(4);
  const headerLength = dbf.readUInt16LE(8);
  const recordLength = dbf.readUInt16LE(10);
  let pos = 32;
  let fieldOffset = 1; // byte 0 of a record is the deletion flag
  let found: { offset: number; length: number } | null = null;
  while (dbf[pos] !== 0x0d && pos < headerLength) {
    const name = dbf.subarray(pos, pos + 11).toString("latin1").replace(/\0.*$/, "").trim();
    const length = dbf[pos + 16]!;
    if (name.toUpperCase() === field.toUpperCase()) found = { offset: fieldOffset, length };
    fieldOffset += length;
    pos += 32;
  }
  if (!found) throw new Error(`the dbf has no field "${field}"`);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = headerLength + i * recordLength + found.offset;
    out.push(dbf.subarray(start, start + found.length).toString("latin1").trim());
  }
  return out;
}
