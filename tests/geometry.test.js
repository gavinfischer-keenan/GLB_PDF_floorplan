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
    segmentsToPolygons
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
    });
});
