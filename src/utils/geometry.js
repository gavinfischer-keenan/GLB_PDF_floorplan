/**
 * 2D geometry utility functions
 */

/**
 * Formats a distance in meters as Feet & Inches (e.g., 3.77m -> 12' 4")
 * @param {number} meters Distance in meters
 * @returns {string} Formatted string in feet and inches
 */
export function formatFeetInches(meters) {
  if (meters == null || isNaN(meters)) return '0\' 0"';
  const totalInches = Math.round(meters * 39.3701);
  const feet = Math.floor(Math.abs(totalInches) / 12);
  const inches = Math.abs(totalInches) % 12;
  const sign = meters < 0 ? '-' : '';
  return `${sign}${feet}' ${inches}"`;
}

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
            p1[0] + (uA * (p2[0] - p1[0])),
            p1[1] + (uA * (p2[1] - p1[1]))
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
    let x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        let xi = polygon[i][0], yi = polygon[i][1];
        let xj = polygon[j][0], yj = polygon[j][1];

        let intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
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
        area += polygon[i][0] * polygon[j][1];
        area -= polygon[j][0] * polygon[i][1];
    }
    return area / 2;
}

/**
 * Calculates the centroid of a polygon.
 * @param {number[][]} polygon Array of points [[x, y], ...]
 * @returns {number[]} Centroid point [x, y]
 */
export function polygonCentroid(polygon) {
    let cx = 0, cy = 0;
    let area = polygonArea(polygon);
    if (area === 0) return [0, 0];
    
    const n = polygon.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const factor = (polygon[i][0] * polygon[j][1] - polygon[j][0] * polygon[i][1]);
        cx += (polygon[i][0] + polygon[j][0]) * factor;
        cy += (polygon[i][1] + polygon[j][1]) * factor;
    }
    
    const f = 1 / (6 * area);
    return [cx * f, cy * f];
}

/**
 * Simplifies a polyline using the Douglas-Peucker algorithm.
 * @param {number[][]} points Array of points [[x, y], ...]
 * @param {number} epsilon Distance threshold for simplification
 * @returns {number[][]} Simplified array of points
 */
export function douglasPeucker(points, epsilon) {
    if (points.length <= 2) return points;

    let dmax = 0;
    let index = 0;
    const end = points.length - 1;

    for (let i = 1; i < end; i++) {
        const d = distancePointToSegment(points[i], points[0], points[end]);
        if (d > dmax) {
            index = i;
            dmax = d;
        }
    }

    if (dmax > epsilon) {
        const recResults1 = douglasPeucker(points.slice(0, index + 1), epsilon);
        const recResults2 = douglasPeucker(points.slice(index), epsilon);
        return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
    } else {
        return [points[0], points[end]];
    }
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
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Merges points that are within a certain tolerance.
 * @param {number[][]} points Array of points [[x, y], ...]
 * @param {number} tolerance Distance tolerance
 * @returns {Object} { mergedPoints: number[][], mapping: number[] }
 */
export function mergeNearbyPoints(points, tolerance) {
    const mergedPoints = [];
    const mapping = new Array(points.length);
    
    for (let i = 0; i < points.length; i++) {
        let found = false;
        for (let j = 0; j < mergedPoints.length; j++) {
            if (distancePointToPoint(points[i], mergedPoints[j]) <= tolerance) {
                mapping[i] = j;
                found = true;
                break;
            }
        }
        if (!found) {
            mapping[i] = mergedPoints.length;
            mergedPoints.push([...points[i]]);
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
    return [point3D[0], point3D[1]]; // 'z' or default
}

/**
 * Connects line segments into closed polygons.
 * @param {number[][][]} segments Array of segments [[[x1, y1], [x2, y2]], ...]
 * @param {number} tolerance Distance tolerance for connecting endpoints
 * @returns {number[][][]} Array of polygons, each an array of points
 */
export function segmentsToPolygons(segments, tolerance) {
    if (!segments || segments.length === 0) return [];

    const points = [];
    const indexPairs = [];
    
    for (const seg of segments) {
        points.push(seg[0], seg[1]);
    }
    
    const { mergedPoints, mapping } = mergeNearbyPoints(points, tolerance);
    
    for (let i = 0; i < segments.length; i++) {
        const idx1 = mapping[i * 2];
        const idx2 = mapping[i * 2 + 1];
        if (idx1 !== idx2) {
            indexPairs.push([idx1, idx2]);
        }
    }
    
    const adj = new Map();
    for (let i = 0; i < mergedPoints.length; i++) {
        adj.set(i, []);
    }
    
    for (const [u, v] of indexPairs) {
        adj.get(u).push(v);
        adj.get(v).push(u);
    }
    
    const polygons = [];
    const visitedEdges = new Set(); 
    
    function getEdgeKey(u, v) {
        return Math.min(u, v) + '_' + Math.max(u, v);
    }
    
    const visitedNodes = new Set();
    
    for (let i = 0; i < mergedPoints.length; i++) {
        if (!visitedNodes.has(i) && adj.get(i).length > 0) {
            let curr = i;
            let path = [curr];
            let currentVisitedNodes = new Set([curr]);
            
            while (true) {
                const neighbors = adj.get(curr);
                let next = -1;
                for (const n of neighbors) {
                    const edgeKey = getEdgeKey(curr, n);
                    if (!visitedEdges.has(edgeKey)) {
                        next = n;
                        visitedEdges.add(edgeKey);
                        break;
                    }
                }
                
                if (next === -1) break; 
                
                curr = next;
                if (currentVisitedNodes.has(curr)) {
                    const loopStartIdx = path.indexOf(curr);
                    if (loopStartIdx !== -1) {
                        const loopIndices = path.slice(loopStartIdx);
                        const polygon = loopIndices.map(idx => mergedPoints[idx]);
                        polygons.push(polygon);
                    }
                    break;
                }
                
                path.push(curr);
                currentVisitedNodes.add(curr);
            }
            
            for (const n of path) visitedNodes.add(n);
        }
    }
    
    return polygons;
}
