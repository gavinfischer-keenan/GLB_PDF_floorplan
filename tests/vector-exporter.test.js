import { describe, it, expect } from 'vitest';
import { buildSVG, buildDXF } from '../src/vector-exporter.js';

const sampleFloor = {
  name: 'Floor 1',
  walls: [
    [[0, 0], [4, 0]],
    [[4, 0], [4, 3]],
    [[4, 3], [0, 3]],
    [[0, 3], [0, 0]],
  ],
  rooms: [
    {
      id: 1,
      name: 'Room',
      displayName: 'Living Room',
      polygon: [[0, 0], [4, 0], [4, 3], [0, 3]],
      centroid: [2, 1.5],
      area: 12,
      perimeter: 14,
    },
  ],
  symbols: [
    { id: 's1', kind: 'door', pos: [2, 0], angle: 0, width: 0.9, swing: 1 },
    { id: 's2', kind: 'window', pos: [4, 1.5], angle: Math.PI / 2, width: 1.2, swing: 1 },
    { id: 's3', kind: 'archway', pos: [2, 3], angle: 0, width: 1.4, swing: 1 },
    { id: 's4', kind: 'stairs', pos: [1.5, 1.5], angle: 0, width: 1.0, length: 2.4, swing: 1 },
  ],
  measurements: [
    { id: 'm1', p1: [0, 0], p2: [4, 0], text: "13' 1\"" },
  ],
  textNotes: [
    { id: 't1', pos: [2, 1.5], text: 'Living Room' },
  ],
  bounds: { minX: 0, minY: 0, maxX: 4, maxY: 3 },
};

describe('Vector Exporters (SVG & DXF)', () => {
  it('buildSVG emits layered architectural SVG with rooms, walls, symbols, dimensions, notes, and optional North arrow', () => {
    const svg = buildSVG({ projectName: 'Villa', floor: sampleFloor, units: 'imperial', showRooms: true, showNorth: true, northAngle: 30 });
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<g id="rooms">');
    expect(svg).toContain('<g id="walls"');
    expect(svg).toContain('<g id="symbols">');
    expect(svg).toContain('<g id="dimensions"');
    expect(svg).toContain('<g id="notes"');
    expect(svg).toContain('<g id="north-arrow"');
    expect(svg).toContain('>UP</text>');
    expect(svg).toContain('Living Room');
    expect(svg).toContain('129 sq ft');
  });

  it('buildDXF emits valid AutoCAD R12 DXF with layers and unit codes', () => {
    const dxfImperial = buildDXF({ floor: sampleFloor, units: 'imperial' });
    expect(dxfImperial).toContain('AC1009');
    expect(dxfImperial).toContain('$INSUNITS\n70\n2');
    expect(dxfImperial).toContain('WALLS');
    expect(dxfImperial).toContain('DOORS');
    expect(dxfImperial).toContain('WINDOWS');
    expect(dxfImperial).toContain('OPENINGS');
    expect(dxfImperial).toContain('STAIRS');
    expect(dxfImperial).toContain('ROOMS');
    expect(dxfImperial).toContain('ARC');
    expect(dxfImperial).toContain('EOF');

    const dxfMetric = buildDXF({ floor: sampleFloor, units: 'metric' });
    expect(dxfMetric).toContain('$INSUNITS\n70\n6');
    expect(dxfMetric).toContain('12.0 m²');
  });
});
