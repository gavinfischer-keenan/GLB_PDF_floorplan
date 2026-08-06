import { describe, it, expect } from 'vitest';
import { detectUpDirection } from '../src/up-detector.js';
import { detectFloor } from '../src/floor-detector.js';
import { detectRooms } from '../src/room-detector.js';

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
    });
});
