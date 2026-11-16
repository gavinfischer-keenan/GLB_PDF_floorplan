import { describe, it, expect } from 'vitest';
import { formatDistance, formatArea } from '../src/utils/units.js';
import { DEFAULT_SETTINGS } from '../src/config/defaults.js';
import {
  loadSettings,
  saveSettings,
  resetSettings,
  diffSettings,
  loadRecentItems,
  addRecentItem,
  clearRecentItems,
  MAX_RECENT_ITEMS,
} from '../src/state/store.js';
import { isTypingInInput } from '../src/ui/shortcuts-overlay.js';
import { filterCommandItems } from '../src/ui/command-palette.js';
import {
  polygonAreaAndCentroid,
  mergeNearbyPoints,
  douglasPeucker,
  segmentsToPolygons,
} from '../src/utils/geometry.js';
import { buildHistogram, smoothHistogram } from '../src/utils/histogram.js';
import { detectFloor } from '../src/floor-detector.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('Units Formatting (units.js)', () => {
  it('formats distances in imperial and metric correctly', () => {
    expect(formatDistance(1.0, 'imperial')).toBe('3\' 3"');
    expect(formatDistance(0.5, 'metric')).toBe('50 cm');
    expect(formatDistance(3.76, 'metric')).toBe('3.76 m');
    expect(formatDistance(0, 'metric')).toBe('0.00 m');
  });

  it('formats areas in imperial and metric correctly', () => {
    expect(formatArea(10, 'imperial')).toBe('108 sq ft');
    expect(formatArea(10, 'metric')).toBe('10.0 m²');
    expect(formatArea(null, 'metric')).toBe('0.0 m²');
  });
});

describe('Settings & Recent Items Store (store.js)', () => {
  it('returns default settings when storage is empty', () => {
    const storage = createMemoryStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('computes exact field diffs and persists updates', () => {
    const storage = createMemoryStorage();
    const { settings, changes } = saveSettings(
      { ...DEFAULT_SETTINGS, units: 'metric', snapAngle: 90, showGrid: false },
      storage
    );
    expect(settings.units).toBe('metric');
    expect(settings.snapAngle).toBe(90);
    expect(settings.showGrid).toBe(false);
    expect(changes).toHaveLength(3);
    expect(changes.map((c) => c.key)).toEqual(['units', 'snapAngle', 'showGrid']);
    expect(changes[0].fromLabel).toContain('Imperial');
    expect(changes[0].toLabel).toContain('Metric');

    expect(loadSettings(storage)).toEqual(settings);

    const reset = resetSettings(storage);
    expect(reset.settings).toEqual(DEFAULT_SETTINGS);
    expect(reset.changes).toHaveLength(3);
  });

  it('tracks, deduplicates, caps, and clears recent items', () => {
    const storage = createMemoryStorage();
    expect(loadRecentItems(storage)).toEqual([]);

    for (let i = 1; i <= MAX_RECENT_ITEMS + 3; i++) {
      addRecentItem({ name: `Scan ${i}`, sourceType: 'file', wallCount: i * 4, roomCount: i }, storage);
    }

    const items = loadRecentItems(storage);
    expect(items).toHaveLength(MAX_RECENT_ITEMS);
    expect(items[0].name).toBe(`Scan ${MAX_RECENT_ITEMS + 3}`);

    // Deduplicate when reopening an existing entry
    addRecentItem({ name: `Scan ${MAX_RECENT_ITEMS}`, sourceType: 'file', wallCount: 99, roomCount: 5 }, storage);
    const deduped = loadRecentItems(storage);
    expect(deduped).toHaveLength(MAX_RECENT_ITEMS);
    expect(deduped[0].name).toBe(`Scan ${MAX_RECENT_ITEMS}`);
    expect(deduped[0].wallCount).toBe(99);

    expect(clearRecentItems(storage)).toEqual([]);
    expect(loadRecentItems(storage)).toEqual([]);
  });

  it('diffSettings compares normalized settings accurately', () => {
    const diffs = diffSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, defaultPaperSize: 'letter' });
    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe('defaultPaperSize');
  });
});

describe('Input Typing Guard & Command Palette Filtering', () => {
  it('detects text-typing elements and ignores non-typing controls', () => {
    expect(isTypingInInput({ target: { tagName: 'INPUT', type: 'text' } })).toBe(true);
    expect(isTypingInInput({ target: { tagName: 'TEXTAREA' } })).toBe(true);
    expect(isTypingInInput({ target: { tagName: 'SELECT' } })).toBe(true);
    expect(isTypingInInput({ target: { tagName: 'DIV', isContentEditable: true } })).toBe(true);

    expect(isTypingInInput({ target: { tagName: 'INPUT', type: 'range' } })).toBe(false);
    expect(isTypingInInput({ target: { tagName: 'BUTTON' } })).toBe(false);
    expect(isTypingInInput({ target: { tagName: 'SVG' } })).toBe(false);
  });

  it('filters command palette items by group, title, subtitle, and keywords', () => {
    const items = [
      { group: 'Pages', title: 'Step 3: Edit Floor Plan', subtitle: 'Draw walls', keywords: 'svg' },
      { group: 'Actions', title: 'Open Settings', subtitle: 'Units & scale', keywords: 'metric' },
      { group: 'Recent Items', title: 'sample_house', subtitle: '4 rooms', keywords: 'recent' },
    ];
    expect(filterCommandItems(items, '')).toHaveLength(3);
    expect(filterCommandItems(items, 'metric')).toHaveLength(1);
    expect(filterCommandItems(items, 'sample_house')).toHaveLength(1);
    expect(filterCommandItems(items, 'nonexistent')).toHaveLength(0);
  });
});

describe('Optimized Math & Geometry Edge Cases', () => {
  it('computes area and centroid in one pass', () => {
    const rect = [[0, 0], [4, 0], [4, 2], [0, 2]];
    const { area, centroid } = polygonAreaAndCentroid(rect);
    expect(area).toBe(8);
    expect(centroid).toEqual([2, 1]);
  });

  it('spatial-hash mergeNearbyPoints handles boundary cells and negative coords identically', () => {
    const pts = [
      [-0.01, -0.01],
      [0.01, 0.01],
      [1.0, 1.0],
      [1.02, 0.99],
      [-5.0, 3.0],
    ];
    const { mergedPoints, mapping } = mergeNearbyPoints(pts, 0.05);
    expect(mergedPoints).toHaveLength(3);
    expect(mapping).toEqual([0, 0, 1, 1, 2]);
  });

  it('index-based Douglas-Peucker simplifies collinear points without mutation', () => {
    const line = [[0, 0], [1, 0.01], [2, -0.01], [3, 0], [3, 2]];
    const simplified = douglasPeucker(line, 0.05);
    expect(simplified).toEqual([[0, 0], [3, 0], [3, 2]]);
  });

  it('segmentsToPolygons prunes dead-end spurs without losing closed loops', () => {
    const segments = [
      [[0, 0], [3, 0]],
      [[3, 0], [3, 3]],
      [[3, 3], [0, 3]],
      [[0, 3], [0, 0]],
      // Dead-end spur attached to corner (3, 0)
      [[3, 0], [5, 0]],
    ];
    const polygons = segmentsToPolygons(segments, 0.05);
    expect(polygons).toHaveLength(1);
    expect(polygons[0]).toHaveLength(4);
  });

  it('smoothHistogram infers minimum step size even when first bins have a gap', () => {
    const raw = buildHistogram([0.0, 0.2, 0.25, 0.3], 0.05);
    expect(Array.from(raw.keys())).toEqual([0, 0.2, 0.25, 0.3]);
    const smoothed = smoothHistogram(raw, 1);
    // At bin 0.25, neighbors are 0.20 (1), 0.25 (1), 0.30 (1) => avg = 1
    expect(smoothed.get(0.25)).toBeCloseTo(1, 5);
  });

  it('detectFloor fallback computes true floor height for negative -y up axis', () => {
    // Two triangles pointing -y (downward in raw coordinates = up when upAxis is '-y')
    // Raw y = -1 is floor, raw y = -4 is ceiling (higher along -y)
    const positions = new Float32Array([
      0, -1, 0, 1, -1, 0, 0, -1, 1, // normal is +y? Wait: e1=(1,0,0), e2=(0,0,1), e1 x e2 = (0,-1,0) -> normal is -y!
      0, -4, 0, 1, -4, 0, 0, -4, 1, // normal is -y at y = -4
    ]);
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
    const floor = detectFloor([{ positions, indices }], '-y');
    expect(floor).not.toBeNull();
    expect(floor.floorHeight).toBeCloseTo(-1, 2);
    expect(floor.sliceHeight).toBeCloseTo(-2, 2);
  });
});
