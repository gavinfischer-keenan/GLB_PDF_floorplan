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
import {
  computeScaleBar,
  computeBlueprintScale,
  getPaperDimensions,
  formatScaleLabel,
  exportPDF,
} from '../src/pdf-exporter.js';

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

  it('computeScaleBar yields exact physical widths in both Imperial and Metric', () => {
    const imp = computeScaleBar(100, 'imperial', 55);
    expect(imp.label).toMatch(/^\d+ ft$/);
    expect(imp.widthMm).toBeLessThanOrEqual(55);
    expect(imp.widthMm).toBeCloseTo(imp.meters * 10, 4); // at 1:100, 1m = 10mm

    const met = computeScaleBar(50, 'metric', 55);
    expect(met.label).toBe('2 m');
    expect(met.widthMm).toBeCloseTo(40, 4); // at 1:50, 2m = 40mm
  });

  it('persists and resets new CAD & detection settings cleanly', () => {
    const storage = createMemoryStorage();
    const { settings, changes } = saveSettings(
      { ...DEFAULT_SETTINGS, showRooms: false, snapToGeometry: false, wallSimplification: 0.05 },
      storage
    );
    expect(settings.showRooms).toBe(false);
    expect(settings.snapToGeometry).toBe(false);
    expect(settings.wallSimplification).toBe(0.05);
    expect(changes).toHaveLength(3);
    expect(loadSettings(storage)).toEqual(settings);

    const reset = resetSettings(storage);
    expect(reset.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('supports US Imperial architectural scales, portrait paper dimensions, and PDF metadata/schedule', () => {
    expect(formatScaleLabel(48, 'imperial')).toBe('1/4" = 1\'-0" (1:48)');
    expect(formatScaleLabel(96, 'imperial')).toBe('1/8" = 1\'-0" (1:96)');
    expect(formatScaleLabel(24, 'metric')).toBe('1:24');

    const port = getPaperDimensions('letter', 'portrait');
    expect(port.width).toBeCloseTo(215.9, 1);
    expect(port.height).toBeCloseTo(279.4, 1);

    const impScale = computeBlueprintScale(
      { minX: 0, minY: 0, maxX: 8, maxY: 6 },
      port,
      { top: 20, right: 20, bottom: 35, left: 20 },
      'auto',
      'imperial'
    );
    expect([12, 24, 48, 96, 120, 192, 240, 480]).toContain(impScale.scale);

    const { doc } = exportPDF({
      projectName: 'Client Residence',
      paperSize: 'letter',
      orientation: 'portrait',
      scale: 48,
      units: 'imperial',
      showRooms: true,
      showNorth: true,
      northAngle: 45,
      includeRoomSchedule: true,
      metadata: { client: 'Jane Doe', address: '123 Main St', author: 'Bay Scallop', sheetNumber: 'A-101' },
      floors: [
        {
          name: 'Ground Floor',
          walls: [[[0, 0], [4, 0]], [[4, 0], [4, 3]], [[4, 3], [0, 3]], [[0, 3], [0, 0]]],
          rooms: [{ name: 'Living Room', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], centroid: [2, 1.5], area: 12 }],
          symbols: [
            { kind: 'door', pos: [2, 0], angle: 0, width: 0.9, swing: 1 },
            { kind: 'archway', pos: [4, 1.5], angle: Math.PI / 2, width: 1.2, swing: 1 },
            { kind: 'stairs', pos: [2, 1.5], angle: 0, width: 1.0, length: 2.6, swing: 1 },
          ],
          bounds: { minX: 0, minY: 0, maxX: 4, maxY: 3 },
        },
      ],
    });
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);

    const storage = createMemoryStorage();
    const { settings } = saveSettings({ ...DEFAULT_SETTINGS, defaultScale: '48' }, storage);
    expect(settings.defaultScale).toBe('48');
  });
});
