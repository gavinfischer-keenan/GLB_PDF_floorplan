import { describe, it, expect } from 'vitest';
import { detectUpDirection } from '../src/up-detector.js';
import { detectFloor, detectFloors } from '../src/floor-detector.js';
import { detectRooms } from '../src/room-detector.js';
import { extractCrossSection } from '../src/cross-section.js';

describe('Detector Modules', () => {
    describe('detectUpDirection', () => {
        it('should detect Z+ up direction for faces aligned with Z axis', () => {
            // Triangle normal is Z+
            const positions = new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0
            ]);
            const indices = new Uint32Array([0, 1, 2]);
            const meshes = [{ positions, indices }];
            
            const result = detectUpDirection(meshes, {
                min: { x: 0, y: 0, z: 0 },
                max: { x: 1, y: 1, z: 0.1 }
            });
            
            expect(result.axis).toBe('+z');
            expect(result.confidence).toBeGreaterThan(0.5);
        });

        it('should detect Y+ up direction for faces aligned with Y axis', () => {
            // Triangle normal is Y+ (x-z plane)
            const positions = new Float32Array([
                0, 0, 0,
                0, 0, 1,
                1, 0, 0
            ]);
            const indices = new Uint32Array([0, 1, 2]);
            const meshes = [{ positions, indices }];
            
            const result = detectUpDirection(meshes, {
                min: { x: 0, y: 0, z: 0 },
                max: { x: 1, y: 0.1, z: 1 }
            });
            
            expect(result.axis).toBe('+y');
        });
    });

    describe('detectFloor', () => {
        it('should detect a floor when enough horizontal faces are present at specific heights', () => {
            // We need at least 5 faces in a bin to register as a peak.
            // Let's create 6 horizontal faces at height 1.0 (Y-up), and 6 at height 4.0.
            const positionsList = [];
            const indicesList = [];
            
            // Generate 6 triangles at y = 1.0
            for (let i = 0; i < 6; i++) {
                const offset = i * 2;
                positionsList.push(
                    offset, 1.0, 0,
                    offset, 1.0, 1,
                    offset + 1, 1.0, 0
                );
                indicesList.push(i * 3, i * 3 + 1, i * 3 + 2);
            }

            // Generate 6 triangles at y = 4.0
            const indexOffset = 18;
            for (let i = 0; i < 6; i++) {
                const offset = i * 2;
                positionsList.push(
                    offset, 4.0, 0,
                    offset, 4.0, 1,
                    offset + 1, 4.0, 0
                );
                indicesList.push(indexOffset + i * 3, indexOffset + i * 3 + 1, indexOffset + i * 3 + 2);
            }

            const meshes = [{
                positions: new Float32Array(positionsList),
                indices: new Uint32Array(indicesList)
            }];

            const floor = detectFloor(meshes, '+y');

            expect(floor).not.toBeNull();
            expect(floor.floorHeight).toBeCloseTo(1.0, 1);
            expect(floor.ceilingHeight).toBeCloseTo(4.0, 1); // Automatically paired with the peak at 4.0
        });
    });

    describe('detectRooms', () => {
        it('should detect rooms inside an outer boundary', () => {
            // Inner square room (2,2) to (5,5) - area = 9
            const innerRoom = [
                [[2, 2], [5, 2]],
                [[5, 2], [5, 5]],
                [[5, 5], [2, 5]],
                [[2, 5], [2, 2]]
            ];

            // Outer boundary square (0,0) to (10,10) - area = 100
            const outerBoundary = [
                [[0, 0], [10, 0]],
                [[10, 0], [10, 10]],
                [[10, 10], [0, 10]],
                [[0, 10], [0, 0]]
            ];

            const segments = [...innerRoom, ...outerBoundary];

            const rooms = detectRooms(segments, 0.05);

            // Should filter out the outer boundary (largest polygon), leaving only the inner room.
            expect(rooms.length).toBe(1);
            expect(rooms[0].area).toBeCloseTo(9, 2);
            expect(rooms[0].name).toBe('Small Room'); // Area = 9 falls in the 5 - 12 range
            expect(rooms[0].type).toBe('small_room');
        });

        it('should detect a standalone single room without requiring an outer shell', () => {
            const singleRoom = [
                [[0, 0], [4, 0]],
                [[4, 0], [4, 3]],
                [[4, 3], [0, 3]],
                [[0, 3], [0, 0]],
            ];
            const rooms = detectRooms(singleRoom, 0.05);
            expect(rooms).toHaveLength(1);
            expect(rooms[0].area).toBeCloseTo(12, 2);
        });

        it('should detect multiple rooms sharing a wall without discarding any room', () => {
            const twoRooms = [
                [[0, 0], [6, 0]],
                [[6, 0], [6, 3]],
                [[6, 3], [0, 3]],
                [[0, 3], [0, 0]],
                [[3, 0], [3, 3]],
            ];
            const rooms = detectRooms(twoRooms, 0.05);
            expect(rooms).toHaveLength(2);
            expect(rooms[0].area).toBeCloseTo(9, 2);
            expect(rooms[1].area).toBeCloseTo(9, 2);
        });
    });

    describe('detectFloors (Multi-Story)', () => {
        it('detects two floors in a 2-story model while ignoring the top roof slab', () => {
            const pos = [];
            const idx = [];
            let vCount = 0;

            const addHorizontalTris = (y, count) => {
                for (let i = 0; i < count; i++) {
                    const x = i * 2;
                    pos.push(x, y, 0, x, y, 1, x + 1, y, 0);
                    idx.push(vCount, vCount + 1, vCount + 2);
                    vCount += 3;
                }
            };

            addHorizontalTris(0.0, 16);  // Floor 1
            addHorizontalTris(3.0, 16);  // Floor 2
            addHorizontalTris(6.0, 16);  // Roof (no geometry > 1.2m above 6.0)

            const meshes = [{
                positions: new Float32Array(pos),
                indices: new Uint32Array(idx),
            }];
            const floors = detectFloors(meshes, '+y', { sliceOffset: 1.0 });
            expect(floors).toHaveLength(2);
            expect(floors[0].name).toBe('Floor 1');
            expect(floors[0].floorHeight).toBeCloseTo(0, 1);
            expect(floors[1].name).toBe('Floor 2');
            expect(floors[1].floorHeight).toBeCloseTo(3.0, 1);
        });
    });

    describe('extractCrossSection (BVH + Simplification)', () => {
        it('slices a large mesh (>= 2000 tris) via MeshBVH and simplifies collinear segments', () => {
            const pos = [];
            const idx = [];
            let v = 0;
            // Build a 2100-triangle vertical wall along z=0 from x=0..50, y=0..3
            const cols = 1050;
            const dx = 50 / cols;
            for (let c = 0; c < cols; c++) {
                const x0 = c * dx;
                const x1 = (c + 1) * dx;
                pos.push(x0, 0, 0, x1, 0, 0, x1, 3, 0, x0, 3, 0);
                idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
                v += 4;
            }
            const meshes = [{
                positions: new Float32Array(pos),
                indices: new Uint32Array(idx),
                triangleCount: 2100,
            }];

            const raw = extractCrossSection(meshes, 1.5, '+y');
            expect(raw.segments.length).toBeGreaterThan(50);

            const simplified = extractCrossSection(meshes, 1.5, '+y', { simplifyEpsilon: 0.02 });
            expect(simplified.segments.length).toBe(1);
            expect(simplified.bounds.maxY - simplified.bounds.minY).toBeCloseTo(50, 1);
        });
    });
});
