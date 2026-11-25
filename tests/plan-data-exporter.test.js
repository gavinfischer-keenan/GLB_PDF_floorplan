import { describe, it, expect } from 'vitest';
import { buildPlanData, parsePlanData } from '../src/plan-data-exporter.js';

// Two rooms sharing a wall, inside an outer boundary (room detection drops the largest loop)
const rect = (x0, y0, x1, y1) => [
  [[x0, y0], [x1, y0]],
  [[x1, y0], [x1, y1]],
  [[x1, y1], [x0, y1]],
  [[x0, y1], [x0, y0]],
];
const walls = [...rect(0, 0, 10, 6), ...rect(0.2, 0.2, 4.2, 3.2), ...rect(5, 0.2, 9, 3.2)];

describe('buildPlanData', () => {
  it('exports rooms and walls in the plan data format', () => {
    const data = buildPlanData({
      projectName: 'Test House',
      floor: { name: 'Floor 1', floorHeight: 0.1, ceilingHeight: 2.54 },
      walls,
    });
    expect(data.format).toBe('glb-floorplan');
    expect(data.version).toBe(1);
    expect(data.units).toBe('m');
    expect(data.projectName).toBe('Test House');
    const floor = data.floors[0];
    expect(floor.name).toBe('Floor 1');
    expect(floor.floorHeight).toBe(0.1);
    expect(floor.ceilingHeight).toBe(2.54);
    expect(floor.walls).toHaveLength(walls.length);
    expect(floor.rooms).toHaveLength(2);
    for (const room of floor.rooms) {
      expect(room.id).toMatch(/^room-\d+$/);
      expect(room.area).toBeCloseTo(12, 1);
      expect(room.polygon.length).toBeGreaterThanOrEqual(4);
      room.polygon.forEach((p) => expect(p).toHaveLength(2));
    }
  });

  it('names a room from a text label placed inside it', () => {
    const data = buildPlanData({
      projectName: 'Test House',
      floor: {},
      walls,
      textNotes: [
        { id: 't1', pos: [2, 1.5], text: '  Kitchen ' },
        { id: 't2', pos: [20, 20], text: 'Outside' },
      ],
    });
    const names = data.floors[0].rooms.map((r) => r.name);
    expect(names).toContain('Kitchen');
    expect(names).not.toContain('Outside');
    expect(data.floors[0].floorHeight).toBeNull();
  });

  it('handles a plan with no walls', () => {
    const data = buildPlanData({ projectName: '', floor: null, walls: [] });
    expect(data.projectName).toBe('Floor Plan');
    expect(data.floors[0].rooms).toEqual([]);
    expect(data.floors[0].walls).toEqual([]);
  });

  it('supports multi-floor round-trip export and parsePlanData import', () => {
    const json = buildPlanData({
      projectName: 'Two Story Villa',
      metadata: { client: 'Acme', address: '45 Oak', author: 'Gavin', sheetNumber: 'A-2', northAngle: 90 },
      floors: [
        {
          name: 'Ground Floor',
          floorHeight: 0,
          ceilingHeight: 3.0,
          sliceHeight: 1.0,
          walls: rect(0, 0, 5, 4),
          scanWalls: rect(0, 0, 5, 4).slice(0, 2),
          draftedWalls: rect(0, 0, 5, 4).slice(2),
          textNotes: [{ id: 't1', pos: [2.5, 2], text: 'Foyer' }],
          measurements: [{ id: 'm1', p1: [0, 0], p2: [5, 0], text: "16' 5\"" }],
          symbols: [
            { id: 's1', kind: 'door', pos: [2.5, 0], angle: 0, width: 0.9, swing: 1 },
            { id: 's2', kind: 'archway', pos: [5, 2], angle: Math.PI / 2, width: 1.4, swing: 1 },
            { id: 's3', kind: 'stairs', pos: [2.5, 2], angle: 0, width: 1.0, length: 2.8, swing: 1 },
          ],
        },
        {
          name: 'Second Floor',
          floorHeight: 3.0,
          ceilingHeight: 6.0,
          sliceHeight: 4.0,
          walls: rect(0, 0, 4, 3),
          textNotes: [{ id: 't2', pos: [2, 1.5], text: 'Primary Bedroom' }],
        },
      ],
    });

    expect(json.floors).toHaveLength(2);
    expect(json.metadata.client).toBe('Acme');
    expect(json.floors[0].scanWalls).toHaveLength(2);
    expect(json.floors[0].draftedWalls).toHaveLength(2);
    expect(json.floors[0].rooms[0].name).toBe('Foyer');
    expect(json.floors[0].symbols).toHaveLength(3);

    const imported = parsePlanData(JSON.stringify(json));
    expect(imported.projectName).toBe('Two Story Villa');
    expect(imported.metadata.sheetNumber).toBe('A-2');
    expect(imported.floors).toHaveLength(2);
    expect(imported.floors[0].scanWalls).toHaveLength(2);
    expect(imported.floors[0].draftedWalls).toHaveLength(2);
    expect(imported.floors[0].rooms[0].displayName).toBe('Foyer');
    expect(imported.floors[0].symbols).toHaveLength(3);
    expect(imported.floors[0].symbols[2].kind).toBe('stairs');
    expect(imported.floors[0].symbols[2].length).toBeCloseTo(2.8, 2);
    expect(imported.floors[1].rooms[0].displayName).toBe('Primary Bedroom');
    expect(imported.floors[1].bounds).not.toBeNull();
  });

  it('rejects invalid plan JSON formats with descriptive errors', () => {
    expect(() => parsePlanData('{bad')).toThrow(/Invalid JSON/);
    expect(() => parsePlanData({ format: 'other', floors: [] })).toThrow(/Unsupported plan format/);
    expect(() => parsePlanData({ format: 'glb-floorplan', floors: [] })).toThrow(/no floors/);
  });
});
