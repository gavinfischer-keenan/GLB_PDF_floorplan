import { polygonAreaAndCentroid, distancePointToPoint, segmentsToPolygons, pointInPolygon } from './utils/geometry.js';

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
 * Discards only outer-shell polygons that strictly enclose other rooms,
 * so standalone single rooms and adjacent shared-wall rooms are both preserved.
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

  // Compute area + centroid for all extracted faces
  const metrics = new Array(polygons.length);
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    const { area: signedArea, centroid } = polygonAreaAndCentroid(polygon);
    metrics[i] = { polygon, area: Math.abs(signedArea), centroid };
  }

  const detectedRooms = [];
  let roomId = 1;

  for (let i = 0; i < metrics.length; i++) {
    const { polygon, area, centroid } = metrics[i];
    if (area < minArea || area > maxArea) continue;

    // Discard polygon i only if it strictly encloses at least one smaller valid room
    let isOuterShell = false;
    for (let j = 0; j < metrics.length; j++) {
      if (i === j) continue;
      const other = metrics[j];
      if (other.area >= minArea && other.area < area * 0.99 && pointInPolygon(other.centroid, polygon)) {
        isOuterShell = true;
        break;
      }
    }
    if (isOuterShell) continue;

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
