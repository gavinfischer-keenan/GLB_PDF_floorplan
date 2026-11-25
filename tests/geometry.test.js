import { describe, it, expect } from 'vitest';
import {
    formatFeetInches,
    lineSegmentIntersection,
    pointInPolygon,
    polygonArea,
    polygonCentroid,
    douglasPeucker,
    distancePointToPoint,
    distancePointToSegment,
    mergeNearbyPoints,
    projectTo2D,
    segmentsToPolygons,
    simplifyWallSegments,
    computeDominantWallAngle,
    rotatePoint,
    scalePoint,
    flipPoint,
    findNearestSnapPoint,
    projectPointToNearestWall,
    segmentIntersectsBox
} from '../src/utils/geometry.js';

describe('Geometry Utils', () => {
    describe('formatFeetInches', () => {
        it('should format meters to feet and inches correctly', () => {
            expect(formatFeetInches(1)).toBe('3\' 3"');
            expect(formatFeetInches(0.3048)).toBe('1\' 0"');
            expect(formatFeetInches(0)).toBe('0\' 0"');
            expect(formatFeetInches(-1)).toBe('-3\' 3"');
            expect(formatFeetInches(null)).toBe('0\' 0"');
        });
    });
    describe('lineSegmentIntersection', () => {
        it('should find the intersection of two crossing segments', () => {
            const p1 = [0, 0];
            const p2 = [2, 2];
            const p3 = [0, 2];
            const p4 = [2, 0];
            const result = lineSegmentIntersection(p1, p2, p3, p4);
            expect(result).toEqual([1, 1]);
        });

        it('should return null for parallel lines', () => {
            const p1 = [0, 0];
            const p2 = [2, 0];
            const p3 = [0, 1];
            const p4 = [2, 1];
            const result = lineSegmentIntersection(p1, p2, p3, p4);
            expect(result).toBeNull();
        });

        it('should return null for non-intersecting lines', () => {
            const p1 = [0, 0];
            const p2 = [1, 1];
            const p3 = [2, 2];
            const p4 = [3, 0];
            const result = lineSegmentIntersection(p1, p2, p3, p4);
            expect(result).toBeNull();
        });
    });

    describe('pointInPolygon', () => {
        const square = [[0, 0], [2, 0], [2, 2], [0, 2]];

        it('should return true for a point inside the polygon', () => {
            expect(pointInPolygon([1, 1], square)).toBe(true);
        });

        it('should return false for a point outside the polygon', () => {
            expect(pointInPolygon([3, 1], square)).toBe(false);
            expect(pointInPolygon([-1, -1], square)).toBe(false);
        });
    });

    describe('polygonArea', () => {
        it('should calculate the correct area for a counter-clockwise square', () => {
            const square = [[0, 0], [2, 0], [2, 2], [0, 2]];
            expect(polygonArea(square)).toBe(4);
        });

        it('should return negative area for a clockwise square', () => {
            const square = [[0, 0], [0, 2], [2, 2], [2, 0]];
            expect(polygonArea(square)).toBe(-4);
        });
    });

    describe('polygonCentroid', () => {
        it('should calculate the centroid of a square', () => {
            const square = [[0, 0], [2, 0], [2, 2], [0, 2]];
            expect(polygonCentroid(square)).toEqual([1, 1]);
        });
    });

    describe('douglasPeucker', () => {
        it('should simplify a line', () => {
            const line = [[0, 0], [1, 0.01], [2, 0], [3, 0]];
            // With epsilon 0.1, it should simplify to start and end
            const simplified = douglasPeucker(line, 0.1);
            expect(simplified).toEqual([[0, 0], [3, 0]]);
        });
    });

    describe('distancePointToPoint', () => {
        it('should calculate Euclidean distance', () => {
            expect(distancePointToPoint([0, 0], [3, 4])).toBe(5);
        });
    });

    describe('distancePointToSegment', () => {
        it('should calculate shortest distance to a segment', () => {
            const start = [0, 0];
            const end = [2, 0];
            // Point perpendicular to segment
            expect(distancePointToSegment([1, 1], start, end)).toBe(1);
            // Point closest to start endpoint
            expect(distancePointToSegment([-1, 0], start, end)).toBe(1);
            // Point closest to end endpoint
            expect(distancePointToSegment([3, 0], start, end)).toBe(1);
        });
    });

    describe('mergeNearbyPoints', () => {
        it('should merge points within tolerance', () => {
            const points = [[0, 0], [0.01, 0.01], [2, 2], [2.01, 2.01]];
            const { mergedPoints, mapping } = mergeNearbyPoints(points, 0.05);
            expect(mergedPoints.length).toBe(2);
            expect(mapping).toEqual([0, 0, 1, 1]);
        });
    });

    describe('projectTo2D', () => {
        it('should drop the requested axis', () => {
            const p3D = [1, 2, 3];
            expect(projectTo2D(p3D, 'x')).toEqual([2, 3]);
            expect(projectTo2D(p3D, 'y')).toEqual([1, 3]);
            expect(projectTo2D(p3D, 'z')).toEqual([1, 2]);
        });
    });

    describe('segmentsToPolygons', () => {
        it('should reconstruct a square polygon from segments', () => {
            const segments = [
                [[0, 0], [2, 0]],
                [[2, 0], [2, 2]],
                [[2, 2], [0, 2]],
                [[0, 2], [0, 0]]
            ];
            const polygons = segmentsToPolygons(segments, 0.05);
            expect(polygons.length).toBe(1);
            expect(polygons[0].length).toBe(4);
            // Loop endpoints should map back correctly
            expect(polygons[0]).toContainEqual([0, 0]);
            expect(polygons[0]).toContainEqual([2, 0]);
            expect(polygons[0]).toContainEqual([2, 2]);
            expect(polygons[0]).toContainEqual([0, 2]);
        });

        it('should extract both bounded rooms sharing an interior partition wall', () => {
            const segments = [
                [[0, 0], [4, 0]],
                [[4, 0], [4, 3]],
                [[4, 3], [0, 3]],
                [[0, 3], [0, 0]],
                // Shared partition wall splitting 4x3 into two 2x3 rooms
                [[2, 0], [2, 3]],
            ];
            const polygons = segmentsToPolygons(segments, 0.05);
            expect(polygons).toHaveLength(2);
            const areas = polygons.map((p) => Math.abs(polygonArea(p))).sort((a, b) => a - b);
            expect(areas[0]).toBeCloseTo(6, 2);
            expect(areas[1]).toBeCloseTo(6, 2);
        });

        it('should split segments at T-junctions before extracting faces', () => {
            // Top & bottom are continuous 6m walls; middle vertical ends on them (T-junctions)
            const segments = [
                [[0, 0], [6, 0]],
                [[6, 0], [6, 4]],
                [[6, 4], [0, 4]],
                [[0, 4], [0, 0]],
                [[3, 0], [3, 4]],
            ];
            const polygons = segmentsToPolygons(segments, 0.05);
            expect(polygons).toHaveLength(2);
            const areas = polygons.map((p) => Math.abs(polygonArea(p))).sort((a, b) => a - b);
            expect(areas[0]).toBeCloseTo(12, 2);
            expect(areas[1]).toBeCloseTo(12, 2);
        });
    });

    describe('simplifyWallSegments', () => {
        it('collapses collinear micro-segments and prunes tiny isolated fragments while preserving loops', () => {
            const segments = [
                // Subdivided top wall (4 collinear pieces) + rest of 4x3 room
                [[0, 0], [1, 0]],
                [[1, 0], [2, 0.005]],
                [[2, 0.005], [3, 0]],
                [[3, 0], [4, 0]],
                [[4, 0], [4, 3]],
                [[4, 3], [0, 3]],
                [[0, 3], [0, 0]],
                // Tiny isolated noise fragment (2 cm)
                [[10, 10], [10.02, 10]],
            ];
            const simplified = simplifyWallSegments(segments, { simplifyEpsilon: 0.02 });
            expect(simplified.length).toBe(4);
            // Closed room still reconstructs cleanly
            const polys = segmentsToPolygons(simplified, 0.05);
            expect(polys).toHaveLength(1);
            expect(Math.abs(polygonArea(polys[0]))).toBeCloseTo(12, 1);
        });
    });

    describe('Plan Alignment, Transforms, Snapping & Marquee Helpers', () => {
        it('estimates dominant wall rotation angle and aligns rotated walls', () => {
            const rot = (15 * Math.PI) / 180;
            const center = [2, 2];
            const raw = [
                [[0, 0], [4, 0]],
                [[4, 0], [4, 3]],
                [[4, 3], [0, 3]],
                [[0, 3], [0, 0]],
            ].map(([a, b]) => [rotatePoint(a, center, rot), rotatePoint(b, center, rot)]);

            const correction = computeDominantWallAngle(raw);
            expect((correction * 180) / Math.PI).toBeCloseTo(-15, 0);
        });

        it('scales and flips points around a center accurately', () => {
            expect(scalePoint([4, 2], [2, 2], 2)).toEqual([6, 2]);
            expect(flipPoint([4, 1], [2, 2], 'x')).toEqual([0, 1]);
            expect(flipPoint([4, 1], [2, 2], 'y')).toEqual([4, 3]);
        });

        it('snaps to endpoints before midpoints and grid', () => {
            const walls = [[[0, 0], [4, 0]]];
            const ep = findNearestSnapPoint([0.05, 0.04], walls, { snapRadius: 0.25 });
            expect(ep.kind).toBe('endpoint');
            expect(ep.point).toEqual([0, 0]);

            const mp = findNearestSnapPoint([2.02, 0.05], walls, { snapRadius: 0.25 });
            expect(mp.kind).toBe('midpoint');
            expect(mp.point).toEqual([2, 0]);
        });

        it('projects door/window placement onto nearest wall and checks marquee box intersection', () => {
            const walls = [[[0, 0], [4, 0]]];
            const hit = projectPointToNearestWall([1.5, 0.12], walls, 0.4);
            expect(hit).not.toBeNull();
            expect(hit.point[0]).toBeCloseTo(1.5, 4);
            expect(hit.point[1]).toBeCloseTo(0, 4);
            expect(hit.angle).toBeCloseTo(0, 4);

            const box = { minX: 1, minY: -1, maxX: 2, maxY: 1 };
            expect(segmentIntersectsBox([[0, 0], [4, 0]], box)).toBe(true);
            expect(segmentIntersectsBox([[0, 5], [4, 5]], box)).toBe(false);
        });
    });
});
