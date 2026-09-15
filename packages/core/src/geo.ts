/**
 * Point in polygon, for district plans published only as boundaries.
 *
 * Even-odd ray casting across every ring of a polygon, so holes need no special case:
 * a point inside a hole crosses one more edge and reads as outside. Coordinates are
 * [lon, lat] in WGS84, the order GeoJSON and shapefiles both use.
 */
export type Ring = Array<[number, number]>;
export type Polygon = Ring[];

export function pointInPolygon(lon: number, lat: number, polygon: Polygon): boolean {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function pointInAny(lon: number, lat: number, polygons: Polygon[]): boolean {
  return polygons.some((p) => pointInPolygon(lon, lat, p));
}

export function bbox(polygons: Polygon[]): { minLon: number; minLat: number; maxLon: number; maxLat: number } {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const p of polygons) {
    for (const ring of p) {
      for (const [x, y] of ring) {
        if (x < minLon) minLon = x;
        if (x > maxLon) maxLon = x;
        if (y < minLat) minLat = y;
        if (y > maxLat) maxLat = y;
      }
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}
