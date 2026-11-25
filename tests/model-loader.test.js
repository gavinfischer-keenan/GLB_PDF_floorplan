import { describe, it, expect } from 'vitest';
import { GLBLoader, isSupported3DFile } from '../src/glb-loader.js';
import { detectUpDirection } from '../src/up-detector.js';
import { extractCrossSection } from '../src/cross-section.js';

describe('Multi-Format 3D Model Loader', () => {
  it('detects supported 3D scan extensions case-insensitively', () => {
    expect(isSupported3DFile('house.glb')).toBe(true);
    expect(isSupported3DFile('house.GLTF')).toBe(true);
    expect(isSupported3DFile('scan.obj')).toBe(true);
    expect(isSupported3DFile('room.STL')).toBe(true);
    expect(isSupported3DFile('mesh.ply')).toBe(true);
    expect(isSupported3DFile('plan.json')).toBe(false);
    expect(isSupported3DFile('photo.png')).toBe(false);
  });

  it('parses Wavefront .obj room geometry and supports up-detection + slicing', () => {
    // Simple 4x3x3 vertical wall box in OBJ format (Y-up)
    const objText = `
v 0 0 0
v 4 0 0
v 4 0 3
v 0 0 3
v 0 3 0
v 4 3 0
v 4 3 3
v 0 3 3
f 1 2 6
f 1 6 5
f 2 3 7
f 2 7 6
f 3 4 8
f 3 8 7
f 4 1 5
f 4 5 8
f 1 4 3
f 1 3 2
`;
    const loader = new GLBLoader();
    const result = loader.parseOBJ(objText);
    expect(result.meshCount).toBe(1);
    expect(result.totalTriangles).toBe(10);
    expect(result.bounds.max.x).toBeCloseTo(4, 3);
    expect(result.bounds.max.y).toBeCloseTo(3, 3);
    expect(result.bounds.max.z).toBeCloseTo(3, 3);

    const up = detectUpDirection(result.meshes, result.bounds);
    expect(up.axis).toBe('+y');

    const slice = extractCrossSection(result.meshes, 1.5, '+y');
    expect(slice.segments.length).toBeGreaterThanOrEqual(4);
  });

  it('parses ASCII .stl triangle geometry', () => {
    const stlText = `solid wall
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 2 0 0
    vertex 0 3 0
  endloop
endfacet
endsolid wall
`;
    const loader = new GLBLoader();
    const result = loader.parseSTL(stlText);
    expect(result.meshCount).toBe(1);
    expect(result.totalTriangles).toBe(1);
    expect(result.bounds.max.x).toBeCloseTo(2, 3);
    expect(result.bounds.max.y).toBeCloseTo(3, 3);
  });

  it('parses meshed ASCII .ply and rejects vertex-only point clouds clearly', () => {
    const meshedPly = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
2 0 0
0 3 0
3 0 1 2
`;
    const loader = new GLBLoader();
    const result = loader.parsePLY(meshedPly);
    expect(result.meshCount).toBe(1);
    expect(result.totalTriangles).toBe(1);

    const pointCloudPly = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
end_header
0 0 0
1 0 0
0 1 0
`;
    const pcBuffer = new TextEncoder().encode(pointCloudPly).buffer;
    expect(() => loader.parsePLY(pcBuffer)).toThrow(/point cloud/i);
  });
});
