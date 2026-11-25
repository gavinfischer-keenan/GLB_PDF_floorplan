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
 * Splits line segments at T-junctions (endpoints landing near another segment's interior)
 * and proper crossing intersections so planar face extraction handles shared walls cleanly.
 * @param {number[][][]} segments
 * @param {number} tolerance
 * @returns {number[][][]}
 */
function splitSegmentsAtIntersections(segments, tolerance) {
  const n = segments.length;
  if (n <= 1) return segments;

  const tolSq = tolerance * tolerance;
  const aabbs = new Array(n);
  const splitParams = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    const [a, b] = segments[i];
    aabbs[i] = [
      Math.min(a[0], b[0]) - tolerance,
      Math.min(a[1], b[1]) - tolerance,
      Math.max(a[0], b[0]) + tolerance,
      Math.max(a[1], b[1]) + tolerance,
    ];
  }

  const recordProjectionSplit = (segIdx, pt) => {
    const [s0, s1] = segments[segIdx];
    const dx = s1[0] - s0[0];
    const dy = s1[1] - s0[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 1e-10) return;

    const t = ((pt[0] - s0[0]) * dx + (pt[1] - s0[1]) * dy) / lenSq;
    if (t <= 0 || t >= 1) return;

    const projX = s0[0] + t * dx;
    const projY = s0[1] + t * dy;
    const ex = pt[0] - projX;
    const ey = pt[1] - projY;
    if (ex * ex + ey * ey > tolSq) return;

    const len = Math.sqrt(lenSq);
    const minDistFromEnd = Math.max(tolerance * 0.5, 1e-4);
    if (t * len > minDistFromEnd && (1 - t) * len > minDistFromEnd) {
      splitParams[segIdx].push(t);
    }
  };

  for (let i = 0; i < n; i++) {
    const boxA = aabbs[i];
    const [a1, a2] = segments[i];

    for (let j = i + 1; j < n; j++) {
      const boxB = aabbs[j];
      if (
        boxA[2] < boxB[0] ||
        boxB[2] < boxA[0] ||
        boxA[3] < boxB[1] ||
        boxB[3] < boxA[1]
      ) {
        continue;
      }

      const [b1, b2] = segments[j];

      // Check T-junctions: endpoints of i onto j, and endpoints of j onto i
      recordProjectionSplit(j, a1);
      recordProjectionSplit(j, a2);
      recordProjectionSplit(i, b1);
      recordProjectionSplit(i, b2);

      // Check proper segment crossing
      const ipt = lineSegmentIntersection(a1, a2, b1, b2);
      if (ipt) {
        recordProjectionSplit(i, ipt);
        recordProjectionSplit(j, ipt);
      }
    }
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const [s0, s1] = segments[i];
    const params = splitParams[i];
    if (params.length === 0) {
      out.push([s0, s1]);
      continue;
    }

    params.sort((a, b) => a - b);
    const dx = s1[0] - s0[0];
    const dy = s1[1] - s0[1];
    const len = Math.hypot(dx, dy);
    const minStepT = len > 0 ? Math.max(1e-5, (tolerance * 0.25) / len) : 1e-5;

    const cleanParams = [0];
    for (let k = 0; k < params.length; k++) {
      const t = params[k];
      if (t - cleanParams[cleanParams.length - 1] > minStepT && 1 - t > minStepT) {
        cleanParams.push(t);
      }
    }
    cleanParams.push(1);

    for (let k = 0; k < cleanParams.length - 1; k++) {
      const t0 = cleanParams[k];
      const t1 = cleanParams[k + 1];
      const p0 = t0 === 0 ? s0 : [s0[0] + t0 * dx, s0[1] + t0 * dy];
      const p1 = t1 === 1 ? s1 : [s0[0] + t1 * dx, s0[1] + t1 * dy];
      out.push([p0, p1]);
    }
  }

  return out;
}

/**
 * Connects line segments into closed room polygons using planar half-edge face extraction.
 * Splits T-junctions and crossings, merges nearby vertices, prunes dead-end spurs,
 * and traverses bounded interior faces so shared-wall multi-room layouts extract cleanly.
 * @param {number[][][]} segments Array of segments [[[x1, y1], [x2, y2]], ...]
 * @param {number} tolerance Distance tolerance for connecting endpoints
 * @returns {number[][][]} Array of polygons, each an array of points
 */
export function segmentsToPolygons(segments, tolerance = 0.05) {
  if (!segments || segments.length === 0) return [];

  const tol = tolerance > 0 ? tolerance : 0;

  // Step A: Initial endpoint merge
  const rawPoints = new Array(segments.length * 2);
  for (let i = 0; i < segments.length; i++) {
    rawPoints[i * 2] = segments[i][0];
    rawPoints[i * 2 + 1] = segments[i][1];
  }
  const initialMerge = mergeNearbyPoints(rawPoints, tol);
  const initialSegs = [];
  for (let i = 0; i < segments.length; i++) {
    const u = initialMerge.mapping[i * 2];
    const v = initialMerge.mapping[i * 2 + 1];
    if (u !== v) {
      initialSegs.push([initialMerge.mergedPoints[u], initialMerge.mergedPoints[v]]);
    }
  }
  if (initialSegs.length === 0) return [];

  // Step B: Split at T-junctions and crossings, then re-merge junctions
  const splitSegs = tol > 0 ? splitSegmentsAtIntersections(initialSegs, tol) : initialSegs;
  const splitPoints = new Array(splitSegs.length * 2);
  for (let i = 0; i < splitSegs.length; i++) {
    splitPoints[i * 2] = splitSegs[i][0];
    splitPoints[i * 2 + 1] = splitSegs[i][1];
  }
  const junctionTol = tol > 0 ? Math.min(tol, 0.02) : 0;
  const { mergedPoints, mapping } = mergeNearbyPoints(splitPoints, junctionTol);
  const nodeCount = mergedPoints.length;

  // Step C: Build deduplicated undirected adjacency list and prune degree-1 spurs
  const adj = Array.from({ length: nodeCount }, () => []);
  const uniqueEdges = new Set();
  let edgeCount = 0;

  for (let i = 0; i < splitSegs.length; i++) {
    const u = mapping[i * 2];
    const v = mapping[i * 2 + 1];
    if (u === v) continue;

    const key = u < v ? `${u}_${v}` : `${v}_${u}`;
    if (!uniqueEdges.has(key)) {
      uniqueEdges.add(key);
      adj[u].push(v);
      adj[v].push(u);
      edgeCount++;
    }
  }

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

  // Step D: Sort each vertex's neighbors ascending by polar angle
  for (let i = 0; i < nodeCount; i++) {
    const neighbors = adj[i];
    if (neighbors.length <= 1) continue;
    const origin = mergedPoints[i];
    neighbors.sort((a, b) => {
      const pa = mergedPoints[a];
      const pb = mergedPoints[b];
      return (
        Math.atan2(pa[1] - origin[1], pa[0] - origin[0]) -
        Math.atan2(pb[1] - origin[1], pb[0] - origin[0])
      );
    });
  }

  // Step E: Directed half-edge planar face traversal
  const polygons = [];
  const visitedHalfEdges = new Set();
  const maxSteps = edgeCount * 2 + 4;

  for (let u = 0; u < nodeCount; u++) {
    const neighbors = adj[u];
    if (neighbors.length < 2) continue;

    for (let ni = 0; ni < neighbors.length; ni++) {
      const v = neighbors[ni];
      const startKey = `${u}->${v}`;
      if (visitedHalfEdges.has(startKey)) continue;

      const cycleIndices = [];
      let prev = u;
      let curr = v;
      let steps = 0;
      let closed = false;

      visitedHalfEdges.add(startKey);
      cycleIndices.push(u);

      while (steps < maxSteps) {
        steps++;
        cycleIndices.push(curr);
        const currNeighbors = adj[curr];
        const deg = currNeighbors.length;
        if (deg === 0) break;

        const inIdx = currNeighbors.indexOf(prev);
        if (inIdx === -1) break;

        const next = currNeighbors[(inIdx - 1 + deg) % deg];
        if (curr === u && next === v) {
          closed = true;
          break;
        }

        const edgeKey = `${curr}->${next}`;
        if (visitedHalfEdges.has(edgeKey)) break;
        visitedHalfEdges.add(edgeKey);

        prev = curr;
        curr = next;
      }

      if (!closed) continue;

      if (cycleIndices.length > 1 && cycleIndices[cycleIndices.length - 1] === u) {
        cycleIndices.pop();
      }
      if (cycleIndices.length < 3) continue;

      const poly = cycleIndices.map((idx) => mergedPoints[idx]);
      // Positive shoelace area selects bounded interior CCW faces and excludes CW unbounded exterior
      if (polygonArea(poly) > 1e-6) {
        polygons.push(poly);
      }
    }
  }

  return polygons;
}

/**
 * Simplifies raw cross-section wall segments by merging nearby vertices, extracting
 * maximal polyline chains/loops, running Douglas-Peucker simplification, and pruning
 * tiny isolated noise fragments.
 * @param {number[][][]} segments
 * @param {{ mergeTolerance?: number, simplifyEpsilon?: number, minIsolatedLength?: number }} [options]
 * @returns {number[][][]}
 */
export function simplifyWallSegments(segments, options = {}) {
  if (!segments || segments.length === 0) return [];

  const {
    mergeTolerance = 0.015,
    simplifyEpsilon = 0.02,
    minIsolatedLength = 0.05,
  } = options;

  if (!(simplifyEpsilon > 0)) {
    return segments.map(([a, b]) => [[a[0], a[1]], [b[0], b[1]]]);
  }

  const points = new Array(segments.length * 2);
  for (let i = 0; i < segments.length; i++) {
    points[i * 2] = segments[i][0];
    points[i * 2 + 1] = segments[i][1];
  }

  const { mergedPoints, mapping } = mergeNearbyPoints(points, mergeTolerance);
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

  const visitedEdges = new Set();
  const simplifiedSegments = [];

  const emitPolyline = (pts, isIsolatedTwoNode = false) => {
    if (pts.length < 2) return;
    if (isIsolatedTwoNode && distancePointToPoint(pts[0], pts[1]) < minIsolatedLength) {
      return;
    }
    const simplified = douglasPeucker(pts, simplifyEpsilon);
    for (let i = 0; i < simplified.length - 1; i++) {
      const a = simplified[i];
      const b = simplified[i + 1];
      if (distancePointToPoint(a, b) > 1e-6) {
        simplifiedSegments.push([[a[0], a[1]], [b[0], b[1]]]);
      }
    }
  };

  // Extract chains starting from non-degree-2 vertices (endpoints & junctions)
  for (let u = 0; u < nodeCount; u++) {
    if (adj[u].length === 0 || adj[u].length === 2) continue;

    for (let k = 0; k < adj[u].length; k++) {
      const v = adj[u][k];
      const startKey = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (visitedEdges.has(startKey)) continue;

      visitedEdges.add(startKey);
      const chain = [u, v];
      let prev = u;
      let curr = v;

      while (adj[curr].length === 2) {
        const next = adj[curr][0] === prev ? adj[curr][1] : adj[curr][0];
        const edgeKey = curr < next ? `${curr}_${next}` : `${next}_${curr}`;
        if (visitedEdges.has(edgeKey)) break;
        visitedEdges.add(edgeKey);
        chain.push(next);
        prev = curr;
        curr = next;
        if (curr === u) break;
      }

      const endVertex = chain[chain.length - 1];
      const isIsolated = chain.length === 2 && adj[u].length === 1 && adj[endVertex].length === 1;
      emitPolyline(chain.map((idx) => mergedPoints[idx]), isIsolated);
    }
  }

  // Extract pure degree-2 closed loops
  for (let u = 0; u < nodeCount; u++) {
    if (adj[u].length !== 2) continue;

    for (let k = 0; k < adj[u].length; k++) {
      const v = adj[u][k];
      const startKey = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (visitedEdges.has(startKey)) continue;

      visitedEdges.add(startKey);
      const loop = [u, v];
      let prev = u;
      let curr = v;

      while (adj[curr].length === 2) {
        const next = adj[curr][0] === prev ? adj[curr][1] : adj[curr][0];
        const edgeKey = curr < next ? `${curr}_${next}` : `${next}_${curr}`;
        if (visitedEdges.has(edgeKey)) break;
        visitedEdges.add(edgeKey);
        loop.push(next);
        prev = curr;
        curr = next;
        if (curr === u) break;
      }

      const pts = loop.map((idx) => mergedPoints[idx]);
      if (pts.length >= 4 && loop[loop.length - 1] === u) {
        let farIdx = 1;
        let maxD = -1;
        for (let i = 1; i < pts.length - 1; i++) {
          const d = distancePointToPoint(pts[0], pts[i]);
          if (d > maxD) {
            maxD = d;
            farIdx = i;
          }
        }
        const half1 = douglasPeucker(pts.slice(0, farIdx + 1), simplifyEpsilon);
        const half2 = douglasPeucker(pts.slice(farIdx), simplifyEpsilon);
        const combined = [...half1, ...half2.slice(1)];
        for (let i = 0; i < combined.length - 1; i++) {
          if (distancePointToPoint(combined[i], combined[i + 1]) > 1e-6) {
            simplifiedSegments.push([
              [combined[i][0], combined[i][1]],
              [combined[i + 1][0], combined[i + 1][1]],
            ]);
          }
        }
      } else {
        emitPolyline(pts, false);
      }
    }
  }

  return simplifiedSegments;
}

/**
 * Estimates the smallest rotation angle in [-pi/4, pi/4] needed to align dominant
 * wall segments horizontally/vertically (Manhattan Auto-Straighten).
 * @param {number[][][]} segments
 * @returns {number} Correction angle in radians
 */
export function computeDominantWallAngle(segments) {
  if (!segments || segments.length === 0) return 0;

  const BIN_COUNT = 180; // 90 deg / 0.5 deg
  const HALF_PI = Math.PI / 2;
  const bins = new Float64Array(BIN_COUNT);
  let totalWeight = 0;

  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.05) continue;

    let angle = Math.atan2(dy, dx) % HALF_PI;
    if (angle < 0) angle += HALF_PI;

    const binIdx = Math.floor((angle / HALF_PI) * BIN_COUNT) % BIN_COUNT;
    bins[binIdx] += len;
    totalWeight += len;
  }

  if (totalWeight === 0) return 0;

  let bestBin = 0;
  let bestScore = -1;
  for (let i = 0; i < BIN_COUNT; i++) {
    let score = 0;
    for (let offset = -2; offset <= 2; offset++) {
      score += bins[(i + offset + BIN_COUNT) % BIN_COUNT];
    }
    if (score > bestScore) {
      bestScore = score;
      bestBin = i;
    }
  }

  // Sub-bin continuous refinement via 4-fold circular weighted mean around peak
  const peakCenterAngle = ((bestBin + 0.5) / BIN_COUNT) * HALF_PI;
  const WINDOW_RAD = (3.0 * Math.PI) / 180;
  let sumCos = 0;
  let sumSin = 0;

  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.05) continue;

    let angle = Math.atan2(dy, dx) % HALF_PI;
    if (angle < 0) angle += HALF_PI;

    let diff = angle - peakCenterAngle;
    if (diff > Math.PI / 4) diff -= HALF_PI;
    if (diff < -Math.PI / 4) diff += HALF_PI;

    if (Math.abs(diff) <= WINDOW_RAD) {
      sumCos += len * Math.cos(4 * angle);
      sumSin += len * Math.sin(4 * angle);
    }
  }

  const refinedAngle = (sumCos !== 0 || sumSin !== 0)
    ? Math.atan2(sumSin, sumCos) / 4
    : peakCenterAngle;

  let correction = -refinedAngle;
  if (correction < -Math.PI / 4) correction += HALF_PI;
  if (correction > Math.PI / 4) correction -= HALF_PI;
  return correction;
}

/**
 * Rotates a 2D point around a center by angleRad radians.
 * @param {number[]} pt
 * @param {number[]} center
 * @param {number} angleRad
 * @returns {[number, number]}
 */
export function rotatePoint(pt, center, angleRad) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = pt[0] - center[0];
  const dy = pt[1] - center[1];
  return [
    center[0] + dx * cos - dy * sin,
    center[1] + dx * sin + dy * cos,
  ];
}

/**
 * Scales a 2D point around a center by a positive factor.
 * @param {number[]} pt
 * @param {number[]} center
 * @param {number} factor
 * @returns {[number, number]}
 */
export function scalePoint(pt, center, factor) {
  return [
    center[0] + (pt[0] - center[0]) * factor,
    center[1] + (pt[1] - center[1]) * factor,
  ];
}

/**
 * Flips a 2D point across a horizontal ('y') or vertical ('x') axis through center.
 * @param {number[]} pt
 * @param {number[]} center
 * @param {'x'|'y'} axis
 * @returns {[number, number]}
 */
export function flipPoint(pt, center, axis) {
  if (axis === 'x') {
    return [center[0] - (pt[0] - center[0]), pt[1]];
  }
  return [pt[0], center[1] - (pt[1] - center[1])];
}

/**
 * Finds the nearest snap target (wall endpoint -> wall midpoint -> grid intersection).
 * @param {number[]} point
 * @param {number[][][]} segments
 * @param {{ snapRadius?: number, snapToEndpoints?: boolean, snapToMidpoints?: boolean, snapToGrid?: boolean, gridSize?: number }} [options]
 * @returns {{ point: [number, number], kind: 'endpoint'|'midpoint'|'grid', dist: number } | null}
 */
export function findNearestSnapPoint(point, segments = [], options = {}) {
  const {
    snapRadius = 0.25,
    snapToEndpoints = true,
    snapToMidpoints = true,
    snapToGrid = true,
    gridSize = 0.5,
  } = options;

  let bestEndpoint = null;
  let bestEndpointDistSq = snapRadius * snapRadius;

  let bestMidpoint = null;
  const midRadius = snapRadius * 0.75;
  let bestMidpointDistSq = midRadius * midRadius;

  if (segments && segments.length > 0 && (snapToEndpoints || snapToMidpoints)) {
    for (let i = 0; i < segments.length; i++) {
      const [a, b] = segments[i];
      if (snapToEndpoints) {
        for (let k = 0; k < 2; k++) {
          const p = k === 0 ? a : b;
          const dx = point[0] - p[0];
          const dy = point[1] - p[1];
          const dSq = dx * dx + dy * dy;
          if (dSq <= bestEndpointDistSq) {
            bestEndpointDistSq = dSq;
            bestEndpoint = { point: [p[0], p[1]], kind: 'endpoint', dist: Math.sqrt(dSq) };
          }
        }
      }
      if (snapToMidpoints) {
        const mx = (a[0] + b[0]) * 0.5;
        const my = (a[1] + b[1]) * 0.5;
        const dx = point[0] - mx;
        const dy = point[1] - my;
        const dSq = dx * dx + dy * dy;
        if (dSq <= bestMidpointDistSq) {
          bestMidpointDistSq = dSq;
          bestMidpoint = { point: [mx, my], kind: 'midpoint', dist: Math.sqrt(dSq) };
        }
      }
    }
  }

  if (bestEndpoint) return bestEndpoint;
  if (bestMidpoint) return bestMidpoint;

  if (snapToGrid && gridSize > 0) {
    const gx = Math.round(point[0] / gridSize) * gridSize;
    const gy = Math.round(point[1] / gridSize) * gridSize;
    const dx = point[0] - gx;
    const dy = point[1] - gy;
    const gridRadius = snapRadius * 0.5;
    const dSq = dx * dx + dy * dy;
    if (dSq <= gridRadius * gridRadius) {
      return { point: [gx, gy], kind: 'grid', dist: Math.sqrt(dSq) };
    }
  }

  return null;
}

/**
 * Projects a point onto the nearest wall segment within maxDist (for placing doors/windows).
 * @param {number[]} point
 * @param {number[][][]} segments
 * @param {number} [maxDist=0.45]
 * @returns {{ point: [number, number], angle: number, wallIndex: number, t: number, dist: number } | null}
 */
export function projectPointToNearestWall(point, segments, maxDist = 0.45) {
  if (!segments || segments.length === 0) return null;

  let best = null;
  let bestDistSq = maxDist * maxDist;

  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-8) continue;

    let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    const px = a[0] + t * dx;
    const py = a[1] + t * dy;
    const ex = point[0] - px;
    const ey = point[1] - py;
    const dSq = ex * ex + ey * ey;

    if (dSq <= bestDistSq) {
      bestDistSq = dSq;
      best = {
        point: [px, py],
        angle: Math.atan2(dy, dx),
        wallIndex: i,
        t,
        dist: Math.sqrt(dSq),
      };
    }
  }

  return best;
}

/**
 * Returns true if point lies inside axis-aligned box { minX, minY, maxX, maxY }.
 * @param {number[]} pt
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} box
 * @returns {boolean}
 */
export function pointInBox(pt, box) {
  return pt[0] >= box.minX && pt[0] <= box.maxX && pt[1] >= box.minY && pt[1] <= box.maxY;
}

/**
 * Returns true if a 2D line segment intersects or lies inside an axis-aligned box.
 * @param {number[][]} seg
 * @param {{ minX: number, minY: number, maxX: number, maxY: number }} box
 * @returns {boolean}
 */
export function segmentIntersectsBox(seg, box) {
  const [a, b] = seg;
  if (pointInBox(a, box) || pointInBox(b, box)) return true;

  const segMinX = Math.min(a[0], b[0]);
  const segMaxX = Math.max(a[0], b[0]);
  const segMinY = Math.min(a[1], b[1]);
  const segMaxY = Math.max(a[1], b[1]);
  if (segMaxX < box.minX || segMinX > box.maxX || segMaxY < box.minY || segMinY > box.maxY) {
    return false;
  }

  const c1 = [box.minX, box.minY];
  const c2 = [box.maxX, box.minY];
  const c3 = [box.maxX, box.maxY];
  const c4 = [box.minX, box.maxY];

  return Boolean(
    lineSegmentIntersection(a, b, c1, c2) ||
    lineSegmentIntersection(a, b, c2, c3) ||
    lineSegmentIntersection(a, b, c3, c4) ||
    lineSegmentIntersection(a, b, c4, c1)
  );
}
