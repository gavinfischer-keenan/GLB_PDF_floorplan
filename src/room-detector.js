import { polygonAreaAndCentroid, distancePointToPoint, segmentsToPolygons } from './utils/geometry.js';

/**
 * Classifies a room by area in square meters.
 * @param {number} area
 * @returns {{ name: string, type: string }}
 */
function classifyRoom(area) {
  if (area > 25) return { name: 'Living Area', type: 'living_area' };
  if (area >= 12) return { name: 'Room', type: 'room' };
  if (area >= 5) return { name: 'Small Room', type: 'small_room' };
  if (area >= 2) return { name: 'Bathroom/Closet', type: 'bathroom' };
  return { name: 'Closet', type: 'closet' };
}

/**
 * Detects closed loops (rooms) from a collection of 2D line segments.
 *
 * @param {Array<[[number, number], [number, number]]>} segments - 2D line segments from cross-section extraction.
 * @param {number | { tolerance?: number, minArea?: number, maxArea?: number }} [toleranceOrOptions=0.05]
 * @returns {Array<{id: number, polygon: Array<[number, number]>, area: number, centroid: [number, number], perimeter: number, dimensions: {width: number, height: number}, name: string, type: string}>}
 */
export function detectRooms(segments, toleranceOrOptions = 0.05) {
  if (!segments || segments.length === 0) {
    return [];
  }

  let tolerance = 0.05;
  let minArea = 1.0;
  let maxArea = 500.0;

  if (typeof toleranceOrOptions === 'object' && toleranceOrOptions !== null) {
    if (typeof toleranceOrOptions.tolerance === 'number') tolerance = toleranceOrOptions.tolerance;
    if (typeof toleranceOrOptions.minArea === 'number') minArea = toleranceOrOptions.minArea;
    if (typeof toleranceOrOptions.maxArea === 'number') maxArea = toleranceOrOptions.maxArea;
  } else if (typeof toleranceOrOptions === 'number') {
    tolerance = toleranceOrOptions;
  }

  const polygons = segmentsToPolygons(segments, tolerance);
  if (!polygons || polygons.length === 0) {
    return [];
  }

  // Single-pass computation of area + centroid and largest outer-boundary identification
  const metrics = new Array(polygons.length);
  let largestArea = -1;
  let largestPolygonIndex = -1;

  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    const { area: signedArea, centroid } = polygonAreaAndCentroid(polygon);
    const area = Math.abs(signedArea);
    metrics[i] = { polygon, area, centroid };

    if (area > largestArea) {
      largestArea = area;
      largestPolygonIndex = i;
    }
  }

  const detectedRooms = [];
  let roomId = 1;

  for (let i = 0; i < metrics.length; i++) {
    // Discard the largest polygon (outer shell boundary) and out-of-range areas
    if (i === largestPolygonIndex) continue;

    const { polygon, area, centroid } = metrics[i];
    if (area < minArea || area > maxArea) continue;

    let perimeter = 0;
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (let j = 0; j < polygon.length; j++) {
      const p1 = polygon[j];
      const p2 = polygon[(j + 1) % polygon.length];

      perimeter += distancePointToPoint(p1, p2);

      if (p1[0] < minX) minX = p1[0];
      if (p1[0] > maxX) maxX = p1[0];
      if (p1[1] < minY) minY = p1[1];
      if (p1[1] > maxY) maxY = p1[1];
    }

    const { name, type } = classifyRoom(area);

    detectedRooms.push({
      id: roomId++,
      polygon,
      area,
      centroid,
      perimeter,
      dimensions: { width: maxX - minX, height: maxY - minY },
      name,
      type,
    });
  }

  return detectedRooms;
}
