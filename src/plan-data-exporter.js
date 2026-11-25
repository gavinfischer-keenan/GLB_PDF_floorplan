import { detectRooms } from './room-detector.js';
import { pointInPolygon, polygonAreaAndCentroid } from './utils/geometry.js';

/**
 * Plan data export & import: the rooms, walls, measurements, notes, and symbols
 * of the edited floor plan as JSON, supporting both Bay Scallop round-trip re-import
 * and PaintingBusinessManager room import.
 *
 * Format (all lengths in meters, plan coordinates as drawn: x right, y down):
 * {
 *   format: 'glb-floorplan', version: 1, units: 'm', projectName, exportedAt,
 *   floors: [{
 *     name, floorHeight, ceilingHeight, sliceHeight,
 *     walls: [[[x1, y1], [x2, y2]], ...],
 *     rooms: [{ id, name, polygon: [[x, y], ...], area, perimeter }],
 *     measurements?: [...],
 *     textNotes?: [...],
 *     symbols?: [...]
 *   }]
 * }
 */

const round = (v, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

function notePoint(note) {
  if (Array.isArray(note.pos)) return note.pos;
  if (note.pos && typeof note.pos.x === 'number') return [note.pos.x, note.pos.y];
  return null;
}

function buildSingleFloorData(floorSpec, defaultIdx, tolerance) {
  const walls = floorSpec.walls || floorSpec.segments || [];
  const scanWalls = Array.isArray(floorSpec.scanWalls) ? floorSpec.scanWalls : null;
  const draftedWalls = Array.isArray(floorSpec.draftedWalls) ? floorSpec.draftedWalls : null;
  const textNotes = floorSpec.textNotes || [];
  const measurements = floorSpec.measurements || [];
  const symbols = floorSpec.symbols || [];
  const rooms = detectRooms(walls, tolerance);

  const exportedRooms = rooms.map((room, i) => {
    const label = textNotes.find((n) => {
      const p = notePoint(n);
      return p && n.text && n.text.trim() && pointInPolygon(p, room.polygon);
    });
    return {
      id: `room-${i + 1}`,
      name: label ? label.text.trim() : (room.displayName || room.name),
      polygon: room.polygon.map(([x, y]) => [round(x), round(y)]),
      area: round(room.area, 3),
      perimeter: round(room.perimeter, 3),
    };
  });

  const result = {
    name: floorSpec.name || `Floor ${defaultIdx + 1}`,
    floorHeight: typeof floorSpec.floorHeight === 'number' ? round(floorSpec.floorHeight) : null,
    ceilingHeight: typeof floorSpec.ceilingHeight === 'number' ? round(floorSpec.ceilingHeight) : null,
    sliceHeight: typeof floorSpec.sliceHeight === 'number' ? round(floorSpec.sliceHeight) : null,
    walls: walls.map(([a, b]) => [
      [round(a[0]), round(a[1])],
      [round(b[0]), round(b[1])],
    ]),
    rooms: exportedRooms,
    measurements: measurements.map((m) => ({
      id: m.id,
      p1: [round(m.p1[0]), round(m.p1[1])],
      p2: [round(m.p2[0]), round(m.p2[1])],
      text: m.text,
    })),
    textNotes: textNotes
      .map((n) => {
        const p = notePoint(n);
        return p ? { id: n.id, pos: [round(p[0]), round(p[1])], text: n.text } : null;
      })
      .filter(Boolean),
    symbols: symbols.map((s) => {
      const defaultW = s.kind === 'door' ? 0.9 : s.kind === 'stairs' ? 1.0 : 1.2;
      const out = {
        id: s.id,
        kind: s.kind,
        pos: [round(s.pos[0]), round(s.pos[1])],
        angle: round(s.angle || 0, 5),
        width: round(s.width || defaultW),
        swing: s.swing === -1 ? -1 : 1,
      };
      if (s.kind === 'stairs') {
        out.length = round(s.length || 2.8);
      }
      return out;
    }),
  };

  if (scanWalls !== null || draftedWalls !== null) {
    result.scanWalls = (scanWalls || []).map(([a, b]) => [
      [round(a[0]), round(a[1])],
      [round(b[0]), round(b[1])],
    ]);
    result.draftedWalls = (draftedWalls || []).map(([a, b]) => [
      [round(a[0]), round(a[1])],
      [round(b[0]), round(b[1])],
    ]);
  }

  return result;
}

/**
 * Build the plan data for one or more floors.
 * Supports both legacy single-floor ({ projectName, floor, walls, ... }) and
 * multi-floor ({ projectName, floors: [...] }) call signatures.
 * @param {Object} opts
 * @returns {Object}
 */
export function buildPlanData(opts) {
  const {
    projectName,
    floors,
    floor,
    walls,
    textNotes = [],
    measurements = [],
    symbols = [],
    metadata = null,
    tolerance = 0.05,
  } = opts || {};

  const floorList = Array.isArray(floors) && floors.length > 0
    ? floors
    : [{
        name: floor?.name || 'Floor 1',
        floorHeight: floor?.floorHeight,
        ceilingHeight: floor?.ceilingHeight,
        sliceHeight: floor?.sliceHeight,
        walls: walls || [],
        textNotes,
        measurements,
        symbols,
      }];

  const output = {
    format: 'glb-floorplan',
    version: 1,
    units: 'm',
    projectName: projectName || 'Floor Plan',
    exportedAt: new Date().toISOString(),
    floors: floorList.map((f, idx) => buildSingleFloorData(f, idx, tolerance)),
  };

  if (metadata && typeof metadata === 'object') {
    output.metadata = { ...metadata };
  }

  return output;
}

function computeFloorBounds(walls, measurements, textNotes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasData = false;

  for (const seg of walls) {
    for (const p of seg) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
      hasData = true;
    }
  }
  for (const m of measurements) {
    minX = Math.min(minX, m.p1[0], m.p2[0]);
    minY = Math.min(minY, m.p1[1], m.p2[1]);
    maxX = Math.max(maxX, m.p1[0], m.p2[0]);
    maxY = Math.max(maxY, m.p1[1], m.p2[1]);
    hasData = true;
  }
  for (const n of textNotes) {
    minX = Math.min(minX, n.pos[0]);
    minY = Math.min(minY, n.pos[1]);
    maxX = Math.max(maxX, n.pos[0]);
    maxY = Math.max(maxY, n.pos[1]);
    hasData = true;
  }

  return hasData ? { minX, minY, maxX, maxY } : null;
}

/**
 * Parses and validates an exported glb-floorplan JSON file back into editable floor plan data.
 * @param {string | Object} jsonInput
 * @param {number} [tolerance=0.05]
 * @returns {{ projectName: string, floors: Array<Object> }}
 */
export function parsePlanData(jsonInput, tolerance = 0.05) {
  let parsed = jsonInput;
  if (typeof jsonInput === 'string') {
    try {
      parsed = JSON.parse(jsonInput);
    } catch (err) {
      throw new Error(`Invalid JSON file: ${err.message}`);
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Plan file must contain a JSON object.');
  }
  if (parsed.format !== 'glb-floorplan') {
    throw new Error(`Unsupported plan format "${parsed.format || 'unknown'}". Expected "glb-floorplan".`);
  }
  if (!Array.isArray(parsed.floors) || parsed.floors.length === 0) {
    throw new Error('Plan file contains no floors.');
  }

  const floors = parsed.floors.map((rawFloor, idx) => {
    const normalizeWallList = (list) => list
      .filter((seg) => Array.isArray(seg) && seg.length === 2 && Array.isArray(seg[0]) && Array.isArray(seg[1]))
      .map(([a, b]) => [
        [Number(a[0]) || 0, Number(a[1]) || 0],
        [Number(b[0]) || 0, Number(b[1]) || 0],
      ]);

    const rawWalls = Array.isArray(rawFloor.walls) ? rawFloor.walls : [];
    const hasSplitLayers = Array.isArray(rawFloor.scanWalls) || Array.isArray(rawFloor.draftedWalls);
    const scanWalls = hasSplitLayers
      ? normalizeWallList(Array.isArray(rawFloor.scanWalls) ? rawFloor.scanWalls : [])
      : [];
    const draftedWalls = hasSplitLayers
      ? normalizeWallList(Array.isArray(rawFloor.draftedWalls) ? rawFloor.draftedWalls : [])
      : normalizeWallList(rawWalls);
    const walls = hasSplitLayers ? [...scanWalls, ...draftedWalls] : draftedWalls;

    const measurements = (Array.isArray(rawFloor.measurements) ? rawFloor.measurements : [])
      .filter((m) => m && Array.isArray(m.p1) && Array.isArray(m.p2))
      .map((m, mi) => ({
        id: m.id || `m_imp_${idx}_${mi}`,
        p1: [Number(m.p1[0]) || 0, Number(m.p1[1]) || 0],
        p2: [Number(m.p2[0]) || 0, Number(m.p2[1]) || 0],
        text: String(m.text || ''),
      }));

    const textNotes = (Array.isArray(rawFloor.textNotes) ? rawFloor.textNotes : [])
      .map((n, ni) => {
        const p = notePoint(n || {});
        if (!p || !n.text) return null;
        return {
          id: n.id || `t_imp_${idx}_${ni}`,
          pos: [Number(p[0]) || 0, Number(p[1]) || 0],
          text: String(n.text),
        };
      })
      .filter(Boolean);

    // Preserve custom room names from JSON if no matching text note already resides inside the room
    const rawRooms = Array.isArray(rawFloor.rooms) ? rawFloor.rooms : [];
    for (let ri = 0; ri < rawRooms.length; ri++) {
      const rr = rawRooms[ri];
      if (!rr || !rr.name || !Array.isArray(rr.polygon) || rr.polygon.length < 3) continue;
      const hasNote = textNotes.some((n) => pointInPolygon(n.pos, rr.polygon));
      if (!hasNote) {
        const defaultNames = new Set(['Living Area', 'Room', 'Small Room', 'Bathroom/Closet', 'Closet']);
        if (!defaultNames.has(rr.name)) {
          const { centroid } = polygonAreaAndCentroid(rr.polygon);
          textNotes.push({
            id: `t_room_${idx}_${ri}`,
            pos: centroid,
            text: String(rr.name),
          });
        }
      }
    }

    const allowedSymbols = new Set(['door', 'window', 'archway', 'stairs']);
    const symbols = (Array.isArray(rawFloor.symbols) ? rawFloor.symbols : [])
      .filter((s) => s && allowedSymbols.has(s.kind) && Array.isArray(s.pos))
      .map((s, si) => {
        const defaultW = s.kind === 'door' ? 0.9 : s.kind === 'stairs' ? 1.0 : 1.2;
        const out = {
          id: s.id || `s_imp_${idx}_${si}`,
          kind: s.kind,
          pos: [Number(s.pos[0]) || 0, Number(s.pos[1]) || 0],
          angle: Number(s.angle) || 0,
          width: Number(s.width) || defaultW,
          swing: s.swing === -1 ? -1 : 1,
        };
        if (s.kind === 'stairs') {
          out.length = Number(s.length) || 2.8;
        }
        return out;
      });

    const rooms = detectRooms(walls, tolerance).map((room) => {
      const labelNote = textNotes.find((n) => n.text.trim() && pointInPolygon(n.pos, room.polygon));
      return {
        ...room,
        displayName: labelNote ? labelNote.text.trim() : room.name,
        labelNoteId: labelNote ? labelNote.id : null,
      };
    });

    const floorHeight = typeof rawFloor.floorHeight === 'number' ? rawFloor.floorHeight : 0;
    const ceilingHeight = typeof rawFloor.ceilingHeight === 'number' ? rawFloor.ceilingHeight : floorHeight + 3.0;
    const sliceHeight = typeof rawFloor.sliceHeight === 'number' ? rawFloor.sliceHeight : floorHeight + 1.0;

    return {
      name: rawFloor.name || `Floor ${idx + 1}`,
      floorHeight,
      ceilingHeight,
      sliceHeight,
      sliceOffset: Math.max(0.1, Math.abs(sliceHeight - floorHeight)),
      segments: walls,
      walls,
      scanWalls,
      draftedWalls,
      measurements,
      textNotes,
      symbols,
      rooms,
      bounds: computeFloorBounds(walls, measurements, textNotes),
      warning: null,
    };
  });

  return {
    projectName: parsed.projectName || 'Imported Floor Plan',
    metadata: parsed.metadata && typeof parsed.metadata === 'object' ? { ...parsed.metadata } : {},
    floors,
  };
}

/**
 * Save the plan data as a .json file (file picker where supported, else a download).
 * @returns {Promise<{success: boolean, method?: string}>}
 */
export async function savePlanData(data, fileName) {
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'Floor plan data', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { success: true, method: 'filesystem' };
    } catch (err) {
      if (err.name === 'AbortError') return { success: false };
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { success: true, method: 'download' };
}
