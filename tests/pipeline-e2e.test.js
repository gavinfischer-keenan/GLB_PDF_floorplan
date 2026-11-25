import { describe, it, expect } from 'vitest';
import { GLBLoader, isSupported3DFile, SUPPORTED_3D_EXTENSIONS } from '../src/glb-loader.js';
import {
  isSupported3DFile as isSupported3DFileUtil,
  SUPPORTED_3D_EXTENSIONS as SUPPORTED_3D_EXTENSIONS_UTIL,
} from '../src/utils/model-formats.js';
import { detectUpDirection } from '../src/up-detector.js';
import { detectFloors } from '../src/floor-detector.js';
import { extractCrossSection } from '../src/cross-section.js';
import { detectRooms } from '../src/room-detector.js';
import { buildPlanData, parsePlanData } from '../src/plan-data-exporter.js';
import { buildSVG, buildDXF } from '../src/vector-exporter.js';
import {
  exportPDF,
  PAPER_SIZES,
  getPaperDimensions,
  formatScaleLabel,
  computeBlueprintScale,
  computeScaleBar,
} from '../src/pdf-exporter.js';
import {
  PAPER_SIZES as PAPER_SIZES_UTIL,
  getPaperDimensions as getPaperDimensionsUtil,
  formatScaleLabel as formatScaleLabelUtil,
  computeBlueprintScale as computeBlueprintScaleUtil,
  computeScaleBar as computeScaleBarUtil,
} from '../src/utils/blueprint-layout.js';

describe('End-to-End 3D -> 2D -> Deliverables Pipeline', () => {
  it('keeps zero-dependency utility exports identical to glb-loader and pdf-exporter re-exports', () => {
    expect(SUPPORTED_3D_EXTENSIONS).toEqual(SUPPORTED_3D_EXTENSIONS_UTIL);
    expect(isSupported3DFile).toBe(isSupported3DFileUtil);

    expect(PAPER_SIZES).toEqual(PAPER_SIZES_UTIL);
    expect(getPaperDimensions).toBe(getPaperDimensionsUtil);
    expect(formatScaleLabel).toBe(formatScaleLabelUtil);
    expect(computeBlueprintScale).toBe(computeBlueprintScaleUtil);
    expect(computeScaleBar).toBe(computeScaleBarUtil);

    expect(getPaperDimensions('tabloid', 'portrait')).toEqual({ width: 279.4, height: 431.8 });
    expect(formatScaleLabel(48, 'imperial')).toContain('1/4" = 1\'-0"');
  });

  it('runs OBJ parse -> up-axis -> floor -> cross-section -> rooms -> JSON round-trip -> SVG/DXF/PDF exports', () => {
    // 6m x 3m x 4m building shell with a 16-triangle base slab so floor detection locks onto y = 0
    const lines = [];
    // Vertices 1..8: outer walls (y=0..3)
    lines.push('v 0 0 0', 'v 6 0 0', 'v 6 0 4', 'v 0 0 4');
    lines.push('v 0 3 0', 'v 6 3 0', 'v 6 3 4', 'v 0 3 4');
    // Outer wall quads as triangles
    lines.push('f 1 2 6', 'f 1 6 5');
    lines.push('f 2 3 7', 'f 2 7 6');
    lines.push('f 3 4 8', 'f 3 8 7');
    lines.push('f 4 1 5', 'f 4 5 8');

    // Interior partition wall at x = 3 (y=0..3, z=0..4)
    lines.push('v 3 0 0', 'v 3 0 4', 'v 3 3 0', 'v 3 3 4'); // 9..12
    lines.push('f 9 10 12', 'f 9 12 11');

    // Dense floor tiles at y=0 (18 triangles) so detectFloors identifies Floor 1 cleanly
    let nextV = 13;
    for (let ix = 0; ix < 3; ix++) {
      for (let iz = 0; iz < 3; iz++) {
        const x0 = ix * 2;
        const x1 = x0 + 2;
        const z0 = iz * 1.3;
        const z1 = z0 + 1.3;
        lines.push(`v ${x0} 0 ${z0}`, `v ${x1} 0 ${z0}`, `v ${x1} 0 ${z1}`, `v ${x0} 0 ${z1}`);
        lines.push(`f ${nextV} ${nextV + 2} ${nextV + 1}`);
        lines.push(`f ${nextV} ${nextV + 3} ${nextV + 2}`);
        nextV += 4;
      }
    }

    const loader = new GLBLoader();
    const model = loader.parseOBJ(lines.join('\n'));
    expect(model.totalTriangles).toBe(28);

    const up = detectUpDirection(model.meshes, model.bounds);
    expect(up.axis).toBe('+y');

    const floors = detectFloors(model.meshes, up.axis, model.bounds, { defaultSliceOffset: 1.0 });
    expect(floors.length).toBeGreaterThanOrEqual(1);
    expect(floors[0].sliceHeight).toBeCloseTo(1.0, 1);

    const slice = extractCrossSection(model.meshes, floors[0].sliceHeight, up.axis, { simplifyEpsilon: 0.02 });
    expect(slice.segments.length).toBeGreaterThanOrEqual(5);

    const rooms = detectRooms(slice.segments, 0.2);
    expect(rooms.length).toBe(2);
    const totalRoomArea = rooms.reduce((sum, r) => sum + r.area, 0);
    expect(totalRoomArea).toBeCloseTo(24, 1);

    // Enrich with drafted wall, dimension, text label, and all 4 symbol types
    const draftedWalls = [[[0, 4], [1, 4]]];
    const symbols = [
      { id: 'sym-door', kind: 'door', pos: [1.5, 0], angle: 0, width: 0.9144, swing: 1 },
      { id: 'sym-win', kind: 'window', pos: [4.5, 0], angle: 0, width: 1.2192, swing: 1 },
      { id: 'sym-arch', kind: 'archway', pos: [2.0, 3], angle: Math.PI / 2, width: 1.2, swing: 1 },
      { id: 'sym-stairs', kind: 'stairs', pos: [4.5, 2], angle: 0, width: 1.0, length: 2.4, swing: 1 },
    ];
    const measurements = [{ id: 'm1', p1: [0, 0], p2: [4, 0], text: '13\' 1"' }];
    const textNotes = [
      { id: 't1', pos: rooms[0].centroid, text: 'Kitchen' },
      { id: 't2', pos: rooms[1].centroid, text: 'Dining' },
    ];
    const allWalls = [...slice.segments, ...draftedWalls];
    const exportMeta = {
      client: 'Jane Doe',
      address: '11 Mosswood Rd',
      author: 'Bay Scallop Studio',
      sheetNumber: 'A1.0',
      orientation: 'portrait',
      showNorth: true,
      northAngle: 45,
      includeRoomSchedule: true,
    };

    const planFloor = {
      name: floors[0].name,
      floorHeight: floors[0].floorHeight,
      ceilingHeight: floors[0].ceilingHeight,
      sliceHeight: floors[0].sliceHeight,
      sliceOffset: 1.0,
      walls: allWalls,
      scanWalls: slice.segments,
      draftedWalls,
      rooms: rooms.map((r, idx) => ({ ...r, displayName: idx === 0 ? 'Kitchen' : 'Dining' })),
      bounds: slice.bounds,
      measurements,
      textNotes,
      symbols,
    };

    // Lossless JSON export & re-import round-trip
    const planData = buildPlanData({
      projectName: 'Mosswood Residence',
      units: 'imperial',
      upAxis: up.axis,
      metadata: exportMeta,
      floors: [planFloor],
    });
    const parsed = parsePlanData(JSON.stringify(planData));
    expect(parsed.projectName).toBe('Mosswood Residence');
    expect(parsed.metadata.sheetNumber).toBe('A1.0');
    expect(parsed.metadata.orientation).toBe('portrait');
    expect(parsed.floors[0].scanWalls).toEqual(slice.segments);
    expect(parsed.floors[0].draftedWalls).toEqual(draftedWalls);
    expect(parsed.floors[0].symbols).toHaveLength(4);
    expect(parsed.floors[0].measurements).toHaveLength(1);
    expect(parsed.floors[0].textNotes).toHaveLength(2);

    // SVG, DXF & PDF exports from restored plan
    const restoredFloor = parsed.floors[0];
    const svg = buildSVG({
      projectName: parsed.projectName,
      floor: restoredFloor,
      units: 'imperial',
      showRooms: true,
      showNorth: true,
      northAngle: 45,
    });
    expect(svg).toContain('<g id="walls"');
    expect(svg).toContain('<g id="symbols">');
    expect(svg).toContain('id="north-arrow"');
    expect(svg).toContain('>N</text>');

    const dxf = buildDXF({ floor: restoredFloor, units: 'imperial' });
    expect(dxf).toContain('OPENINGS');
    expect(dxf).toContain('STAIRS');
    expect(dxf).toContain('DIMENSIONS');

    const pdfResult = exportPDF({
      projectName: parsed.projectName,
      paperSize: 'letter',
      orientation: 'portrait',
      scale: 48,
      units: 'imperial',
      showRooms: true,
      showNorth: true,
      northAngle: 45,
      includeRoomSchedule: true,
      metadata: parsed.metadata,
      floors: [restoredFloor],
    });
    expect(pdfResult.doc.getNumberOfPages()).toBe(1);
    const pdfArrayBuf = pdfResult.doc.output('arraybuffer');
    expect(pdfArrayBuf.byteLength).toBeGreaterThan(2000);
  });
});
