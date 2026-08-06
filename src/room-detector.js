import { polygonArea, polygonCentroid, distancePointToPoint, segmentsToPolygons } from './utils/geometry.js';

/**
 * Detects closed loops (rooms) from a collection of 2D line segments.
 * 
 * @param {Array<[[number, number], [number, number]]>} segments - 2D line segments from cross-section extraction.
 * @param {number} tolerance - Tolerance for merging nearby endpoints (default 0.05m).
 * @returns {Array<{id: number, polygon: Array<[number, number]>, area: number, centroid: [number, number], perimeter: number, dimensions: {width: number, height: number}, name: string, type: string}>}
 */
export function detectRooms(segments, tolerance = 0.05) {
  if (!segments || segments.length === 0) {
    return [];
  }

  // Build graph and find closed cycles using segmentsToPolygons
  // (internally handles endpoint merging via tolerance)
  const polygons = segmentsToPolygons(segments, tolerance);

  if (!polygons || polygons.length === 0) {
    return [];
  }

  let detectedRooms = [];
  let largestArea = -1;
  let largestPolygonIndex = -1;

  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    const area = Math.abs(polygonArea(polygon));
    
    if (area > largestArea) {
      largestArea = area;
      largestPolygonIndex = i;
    }
  }

  let roomId = 1;

  for (let i = 0; i < polygons.length; i++) {
    // 6. Filter: Remove the largest polygon (outer boundary)
    if (i === largestPolygonIndex) continue;

    const polygon = polygons[i];
    const area = Math.abs(polygonArea(polygon));

    // 6. Filter: Remove noise (< 1.0 m²) and huge outdoor scans (> 500 m²)
    if (area < 1.0 || area > 500.0) continue;

    const centroid = polygonCentroid(polygon);
    
    let perimeter = 0;
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (let j = 0; j < polygon.length; j++) {
      const p1 = polygon[j];
      const p2 = polygon[(j + 1) % polygon.length];
      
      perimeter += distancePointToPoint(p1, p2);
      
      minX = Math.min(minX, p1[0]);
      maxX = Math.max(maxX, p1[0]);
      minY = Math.min(minY, p1[1]);
      maxY = Math.max(maxY, p1[1]);
    }

    const width = maxX - minX;
    const height = maxY - minY;

    // 7. Auto-label rooms by area
    let name = 'Closet';
    let type = 'closet';
    
    if (area > 25) {
      name = 'Living Area';
      type = 'living_area';
    } else if (area >= 12) {
      name = 'Room';
      type = 'room';
    } else if (area >= 5) {
      name = 'Small Room';
      type = 'small_room';
    } else if (area >= 2) {
      name = 'Bathroom/Closet';
      type = 'bathroom';
    }

    detectedRooms.push({
      id: roomId++,
      polygon,
      area,
      centroid,
      perimeter,
      dimensions: { width, height },
      name,
      type
    });
  }

  return detectedRooms;
}
