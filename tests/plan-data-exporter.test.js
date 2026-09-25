import { describe, it, expect } from 'vitest';
import { buildPlanData } from '../src/plan-data-exporter.js';

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
});
