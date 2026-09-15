import { describe, expect, it } from "vitest";
import { bbox, pointInAny, pointInPolygon, type Polygon } from "./geo.js";

const square: Polygon = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
const withHole: Polygon = [square[0]!, [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]];

describe("point in polygon", () => {
  it("finds points inside and outside", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(11, 5, square)).toBe(false);
  });

  it("treats a hole as outside", () => {
    expect(pointInPolygon(5, 5, withHole)).toBe(false);
    expect(pointInPolygon(2, 2, withHole)).toBe(true);
  });

  it("checks every polygon of a multipolygon", () => {
    const islands: Polygon[] = [square, [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]];
    expect(pointInAny(25, 25, islands)).toBe(true);
    expect(pointInAny(15, 15, islands)).toBe(false);
    expect(bbox(islands)).toEqual({ minLon: 0, minLat: 0, maxLon: 30, maxLat: 30 });
  });
});
