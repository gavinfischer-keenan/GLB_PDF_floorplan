/**
 * 2D geometry utility functions
 */
import { formatFeetInches, formatDistance, formatArea } from './units.js';

export { formatFeetInches, formatDistance, formatArea };

/**
 * Calculates the intersection of two line segments, if any.
 * @param {number[]} p1 Start point of segment 1 [x, y]
 * @param {number[]} p2 End point of segment 1 [x, y]
 * @param {number[]} p3 Start point of segment 2 [x, y]
 * @param {number[]} p4 End point of segment 2 [x, y]
 * @returns {number[]|null} The intersection point [x, y] or null if no intersection
 */
export function lineSegmentIntersection(p1, p2, p3, p4) {
  const d = (p4[1] - p3[1]) * (p2[0] - p1[0]) - (p4[0] - p3[0]) * (p2[1] - p1[1]);
  if (d === 0) return null; // Parallel

  const uA = ((p4[0] - p3[0]) * (p1[1] - p3[1]) - (p4[1] - p3[1]) * (p1[0] - p3[0])) / d;
  const uB = ((p2[0] - p1[0]) * (p1[1] - p3[1]) - (p2[1] - p1[1]) * (p1[0] - p3[0])) / d;

  if (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1) {
    return [
      p1[0] + uA * (p2[0] - p1[0]),
      p1[1] + uA * (p2[1] - p1[1]),
    ];
  }
  return null;
}

/**
 * Determines if a point is inside a polygon using ray casting.
 * @param {number[]} point Point to test [x, y]
 * @param {number[][]} polygon Array of points [[x, y], ...]
 * @returns {boolean} True if point is inside
 */
export function pointInPolygon(point, polygon) {
  const x = point[0];
  const y = point[1];
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calculates the signed area of a polygon using the shoelace formula.
 * @param {number[][]} polygon Array of points [[x, y], ...]
 * @returns {number} Signed area (positive if counter-clockwise)
 */
export function polygonArea(polygon) {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i][0] * polygon[j][1] - polygon[j][0] * polygon[i][1];
  }
  return area / 2;
}

/**
 * Calculates both signed area and centroid of a polygon in a single O(N) pass.
 * @param {number[][]} polygon Array of points [[x, y], ...]
 * @returns {{ area: number, centroid: [number, number] }}
 */
export function polygonAreaAndCentroid(polygon) {
  const n = polygon ? polygon.length : 0;
  if (n === 0) return { area: 0, centroid: [0, 0] };

  let twiceArea = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];
    const cross = p1[0] * p2[1] - p2[0] * p1[1];
    twiceArea += cross;
    cx += (p1[0] + p2[0]) * cross;
    cy += (p1[1] + p2[1]) * cross;
  }

  const area = twiceArea / 2;
  if (area === 0) return { area: 0, centroid: [0, 0] };

  const f = 1 / (6 * area);
  return { area, centroid: [cx * f, cy * f] };
}

/**
 * Calculates the centroid of a polygon.
 * @param {number[][]} polygon Array of points [[x, y], ...]
 * @returns {number[]} Centroid point [x, y]
 */
export function polygonCentroid(polygon) {
  return polygonAreaAndCentroid(polygon).centroid;
}

/**
 * Calculates squared perpendicular distance from a point to a line segment (sqrt-free).
 * @param {number[]} point [x, y]
 * @param {number[]} segStart [x, y]
 * @param {number[]} segEnd [x, y]
 * @returns {number} Squared distance
 */
export function distanceSqPointToSegment(point, segStart, segEnd) {
  let x = segStart[0];
  let y = segStart[1];
  let dx = segEnd[0] - x;
  let dy = segEnd[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = segEnd[0];
      y = segEnd[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function _douglasPeuckerIndices(points, startIdx, endIdx, epsilonSq, keepFlags) {
  if (endIdx - startIdx <= 1) return;

  let dmaxSq = 0;
  let index = startIdx;
  const startPt = points[startIdx];
  const endPt = points[endIdx];

  for (let i = startIdx + 1; i < endIdx; i++) {
    const dSq = distanceSqPointToSegment(points[i], startPt, endPt);
    if (dSq > dmaxSq) {
      index = i;
      dmaxSq = dSq;
    }
  }

  if (dmaxSq > epsilonSq) {
    keepFlags[index] = 1;
    _douglasPeuckerIndices(points, startIdx, index, epsilonSq, keepFlags);
    _douglasPeuckerIndices(points, index, endIdx, epsilonSq, keepFlags);
  }
}

/**
 * Simplifies a polyline using an index-based, sqrt-free Douglas-Peucker algorithm.
 * @param {number[][]} points Array of points [[x, y], ...]
 * @param {number} epsilon Distance threshold for simplification
 * @returns {number[][]} Simplified array of points
 */
export function douglasPeucker(points, epsilon) {
  if (!points || points.length <= 2) return points;

  const keepFlags = new Uint8Array(points.length);
  keepFlags[0] = 1;
  keepFlags[points.length - 1] = 1;

  _douglasPeuckerIndices(points, 0, points.length - 1, epsilon * epsilon, keepFlags);

  const result = [];
  for (let i = 0; i < points.length; i++) {
    if (keepFlags[i]) {
      result.push(points[i]);
    }
  }
  return result;
}

/**
 * Calculates distance between two 2D points.
 * @param {number[]} p1 [x, y]
 * @param {number[]} p2 [x, y]
 * @returns {number} Distance
 */
export function distancePointToPoint(p1, p2) {
  const dx = p1[0] - p2[0];
  const dy = p1[1] - p2[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates perpendicular distance from a point to a line segment.
 * @param {number[]} point [x, y]
 * @param {number[]} segStart [x, y]
 * @param {number[]} segEnd [x, y]
 * @returns {number} Distance
 */
export function distancePointToSegment(point, segStart, segEnd) {
  return Math.sqrt(distanceSqPointToSegment(point, segStart, segEnd));
}

/**
 * Merges points that are within a tolerance in O(N) average time via a 2D spatial grid hash.
 * Preserves lowest-index match ordering identically to the naive O(N^2) scan.
 * @param {number[][]} points Array of points [[x, y], ...]
 * @param {number} tolerance Distance tolerance
 * @returns {{ mergedPoints: number[][], mapping: number[] }}
 */
export function mergeNearbyPoints(points, tolerance) {
  if (!points || points.length === 0) {
    return { mergedPoints: [], mapping: [] };
  }

  const mergedPoints = [];
  const mapping = new Array(points.length);

  if (!(tolerance > 0)) {
    const exactMap = new Map();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const key = `${p[0]}_${p[1]}`;
      if (exactMap.has(key)) {
        mapping[i] = exactMap.get(key);
      } else {
        const idx = mergedPoints.length;
        exactMap.set(key, idx);
        mapping[i] = idx;
        mergedPoints.push([p[0], p[1]]);
      }
    }
    return { mergedPoints, mapping };
  }

  const invTol = 1 / tolerance;
  const tolSq = tolerance * tolerance;
  const grid = new Map();

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const px = p[0];
    const py = p[1];
    const cx = Math.floor(px * invTol);
    const cy = Math.floor(py * invTol);

    let bestIdx = Infinity;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${cx + dx},${cy + dy}`);
        if (!bucket) continue;

        for (let k = 0; k < bucket.length; k++) {
          const mIdx = bucket[k];
          if (mIdx >= bestIdx) continue;
          const mp = mergedPoints[mIdx];
          const ddx = px - mp[0];
          const ddy = py - mp[1];
          if (ddx * ddx + ddy * ddy <= tolSq) {
            bestIdx = mIdx;
          }
        }
      }
    }

    if (bestIdx !== Infinity) {
      mapping[i] = bestIdx;
    } else {
      const newIdx = mergedPoints.length;
      mapping[i] = newIdx;
      mergedPoints.push([px, py]);
      const cellKey = `${cx},${cy}`;
      let bucket = grid.get(cellKey);
      if (!bucket) {
        bucket = [];
        grid.set(cellKey, bucket);
      }
      bucket.push(newIdx);
    }
  }

  return { mergedPoints, mapping };
}

/**
 * Projects a 3D point to 2D by dropping the specified up-axis.
 * @param {number[]} point3D [x, y, z]
 * @param {string} upAxis 'x', 'y', or 'z'
 * @returns {number[]} 2D point [x, y]
 */
export function projectTo2D(point3D, upAxis) {
  if (upAxis === 'x') return [point3D[1], point3D[2]];
  if (upAxis === 'y') return [point3D[0], point3D[2]];
  return [point3D[0], point3D[1]];
}

/**
 * Connects line segments into closed polygons.
 * Deduplicates edges, prunes dead-end degree-1 spurs, and extracts cycles with O(1) lookup.
 * @param {number[][][]} segments Array of segments [[[x1, y1], [x2, y2]], ...]
 * @param {number} tolerance Distance tolerance for connecting endpoints
 * @returns {number[][][]} Array of polygons, each an array of points
 */
export function segmentsToPolygons(segments, tolerance) {
  if (!segments || segments.length === 0) return [];

  const points = new Array(segments.length * 2);
  for (let i = 0; i < segments.length; i++) {
    points[i * 2] = segments[i][0];
    points[i * 2 + 1] = segments[i][1];
  }

  const { mergedPoints, mapping } = mergeNearbyPoints(points, tolerance);
  const nodeCount = mergedPoints.length;

  const adj = Array.from({ length: nodeCount }, () => []);
  const uniqueEdges = new Set();

  for (let i = 0; i < segments.length; i++) {
    const u = mapping[i * 2];
    const v = mapping[i * 2 + 1];
    if (u === v) continue;

    const key = u < v ? `${u}_${v}` : `${v}_${u}`;
    if (!uniqueEdges.has(key)) {
      uniqueEdges.add(key);
      adj[u].push(v);
      adj[v].push(u);
    }
  }

  // Prune dead-end spur vertices (degree === 1) iteratively
  const spurQueue = [];
  for (let i = 0; i < nodeCount; i++) {
    if (adj[i].length === 1) {
      spurQueue.push(i);
    }
  }

  let head = 0;
  while (head < spurQueue.length) {
    const u = spurQueue[head++];
    if (adj[u].length !== 1) continue;
    const v = adj[u].pop();
    const vNeighbors = adj[v];
    const idx = vNeighbors.indexOf(u);
    if (idx !== -1) {
      vNeighbors.splice(idx, 1);
    }
    if (vNeighbors.length === 1) {
      spurQueue.push(v);
    }
  }

  const polygons = [];
  const visitedEdges = new Set();
  const visitedNodes = new Uint8Array(nodeCount);

  for (let i = 0; i < nodeCount; i++) {
    if (!visitedNodes[i] && adj[i].length > 0) {
      let curr = i;
      const path = [curr];
      const pathIndexMap = new Map([[curr, 0]]);

      while (true) {
        const neighbors = adj[curr];
        let next = -1;
        for (let k = 0; k < neighbors.length; k++) {
          const n = neighbors[k];
          const edgeKey = curr < n ? `${curr}_${n}` : `${n}_${curr}`;
          if (!visitedEdges.has(edgeKey)) {
            next = n;
            visitedEdges.add(edgeKey);
            break;
          }
        }

        if (next === -1) break;

        curr = next;
        const loopStartIdx = pathIndexMap.get(curr);
        if (loopStartIdx !== undefined) {
          const loopIndices = path.slice(loopStartIdx);
          if (loopIndices.length >= 3) {
            polygons.push(loopIndices.map((idx) => mergedPoints[idx]));
          }
          break;
        }

        pathIndexMap.set(curr, path.length);
        path.push(curr);
      }

      for (let p = 0; p < path.length; p++) {
        visitedNodes[path[p]] = 1;
      }
    }
  }

  return polygons;
}
