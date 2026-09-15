import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_PLANS, parseBlockAssignments } from "./block-plans.js";

const here = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__");
const excerpt = readFileSync(join(here, "tx-planc2333-excerpt.csv"), "utf8");

describe("block assignment files", () => {
  it("reads the Texas 2026 plan's own format", () => {
    const rows = parseBlockAssignments(excerpt);
    expect(rows[0]).toEqual({ block: "480019501001000", district: "5" });
    // Dallas City Hall's block. District 30 on the Census layer, 33 on the enacted plan.
    expect(rows.find((r) => r.block === "481130204021051")?.district).toBe("33");
  });

  it("skips unassigned water blocks and strips padding", () => {
    const rows = parseBlockAssignments("GEOID20,DISTRICT\n060014001001000,07\n060014001001001,ZZ\n");
    expect(rows).toEqual([{ block: "060014001001000", district: "7" }]);
  });

  it("reads a headerless file saved with a byte-order mark", () => {
    // California's AB 604 file: no header, BOM before the first quoted block.
    const rows = parseBlockAssignments('\uFEFF"060650444033050","25"\n"060650444033049","25"\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ block: "060650444033050", district: "25" });
  });

  it("throws on a malformed row instead of assigning half a state", () => {
    expect(() => parseBlockAssignments("BLOCK,DISTRICT\n4800195,5\n")).toThrow(/15-digit/);
    expect(() => parseBlockAssignments("BLOCK,DISTRICT\n480019501001000,five\n")).toThrow(/not a number/);
  });

  it("registers only plans from the enacting body, one per state and chamber", () => {
    const keys = KNOWN_PLANS.map((p) => `${p.state}|${p.chamber}|${p.firstElection}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("plans published as boundaries", () => {
  it("reads districts from a feature layer's GeoJSON", async () => {
    const { geojsonToBoundaries } = await import("./block-plans.js");
    const shapes = geojsonToBoundaries(
      {
        features: [
          { properties: { district: "08" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
          { properties: { district: "8" }, geometry: { type: "MultiPolygon", coordinates: [[[[5, 5], [6, 5], [6, 6], [5, 5]]]] } },
        ],
      },
      "district",
    );
    // Two features for one district are one district with two polygons.
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.district).toBe("8");
    expect(shapes[0]!.polygons).toHaveLength(2);
    expect(shapes[0]!.maxLon).toBe(6);
  });

  it("reads a polygon shapefile and its district column", async () => {
    const { shapefileToBoundaries } = await import("./block-plans.js");
    // One square polygon record, district "3".
    const ring = [[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]];
    const content = Buffer.alloc(44 + 4 + ring.length * 16);
    content.writeInt32LE(5, 0);
    content.writeInt32LE(1, 36);
    content.writeInt32LE(ring.length, 40);
    content.writeInt32LE(0, 44);
    ring.forEach(([x, y], i) => {
      content.writeDoubleLE(x!, 48 + i * 16);
      content.writeDoubleLE(y!, 56 + i * 16);
    });
    const header = Buffer.alloc(100);
    const recHeader = Buffer.alloc(8);
    recHeader.writeInt32BE(1, 0);
    recHeader.writeInt32BE(content.length / 2, 4);
    const shp = Buffer.concat([header, recHeader, content]);

    const field = Buffer.alloc(32);
    field.write("DISTRICT", 0, "latin1");
    field.write("C", 11, "latin1");
    field[16] = 2;
    const dbfHeader = Buffer.alloc(32);
    dbfHeader.writeUInt32LE(1, 4);
    dbfHeader.writeUInt16LE(32 + 32 + 1, 8);
    dbfHeader.writeUInt16LE(1 + 2, 10);
    const dbf = Buffer.concat([dbfHeader, field, Buffer.from([0x0d]), Buffer.from(" 3", "latin1")]);

    const shapes = shapefileToBoundaries(shp, dbf, "DISTRICT");
    expect(shapes).toEqual([
      { district: "3", polygons: [[ring]], minLon: 0, minLat: 0, maxLon: 2, maxLat: 2 },
    ]);
  });

  it("reads Louisiana's space-separated file", () => {
    const rows = parseBlockAssignments("220019601011000   3\r\n220019601011001   3\r\n");
    expect(rows).toEqual([
      { block: "220019601011000", district: "3" },
      { block: "220019601011001", district: "3" },
    ]);
  });
});
