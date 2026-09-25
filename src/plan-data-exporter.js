import { detectRooms } from './room-detector.js';
import { pointInPolygon } from './utils/geometry.js';

/**
 * Plan data export: the rooms and walls of the edited floor plan as JSON, so
 * another app (PaintingBusinessManager) can import the plan and link its rooms.
 *
 * Format (all lengths in meters, plan coordinates as drawn: x right, y down):
 * {
 *   format: 'glb-floorplan', version: 1, units: 'm', projectName, exportedAt,
 *   floors: [{
 *     name, floorHeight, ceilingHeight,
 *     walls: [[[x1, y1], [x2, y2]], ...],
 *     rooms: [{ id, name, polygon: [[x, y], ...], area, perimeter }]
 *   }]
 * }
 */

const round = (v, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

function notePoint(note) {
  if (Array.isArray(note.pos)) return note.pos;
  if (note.pos && typeof note.pos.x === 'number') return [note.pos.x, note.pos.y];
  return null;
}

/**
 * Build the plan data for one floor.
 * @param {Object} opts
 * @param {string} opts.projectName
 * @param {{name?: string, floorHeight?: number, ceilingHeight?: number}} opts.floor
 * @param {Array<[[number, number], [number, number]]>} opts.walls Edited wall segments
 * @param {Array<{pos: [number, number], text: string}>} [opts.textNotes] Text labels; a label inside a room names it
 * @returns {Object}
 */
export function buildPlanData({ projectName, floor, walls, textNotes = [] }) {
  const rooms = detectRooms(walls || [], 0.05);

  const exportedRooms = rooms.map((room, i) => {
    // A text label placed inside the room on the editor names it
    const label = textNotes.find((n) => {
      const p = notePoint(n);
      return p && n.text && n.text.trim() && pointInPolygon(p, room.polygon);
    });
    return {
      id: `room-${i + 1}`,
      name: label ? label.text.trim() : room.name,
      polygon: room.polygon.map(([x, y]) => [round(x), round(y)]),
      area: round(room.area, 3),
      perimeter: round(room.perimeter, 3),
    };
  });

  return {
    format: 'glb-floorplan',
    version: 1,
    units: 'm',
    projectName: projectName || 'Floor Plan',
    exportedAt: new Date().toISOString(),
    floors: [
      {
        name: floor?.name || 'Floor 1',
        floorHeight: typeof floor?.floorHeight === 'number' ? round(floor.floorHeight) : null,
        ceilingHeight: typeof floor?.ceilingHeight === 'number' ? round(floor.ceilingHeight) : null,
        walls: (walls || []).map(([a, b]) => [
          [round(a[0]), round(a[1])],
          [round(b[0]), round(b[1])],
        ]),
        rooms: exportedRooms,
      },
    ],
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
      // Fall through to a plain download
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
