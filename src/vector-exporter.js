/**
 * Vector Exporters — generates standalone architectural SVG and AutoCAD R12 DXF files.
 */
import { formatDistance, formatArea, pointInPolygon } from './utils/geometry.js';

const METERS_TO_FEET = 3.28084;

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getBoundsFallback(floor) {
  if (floor?.bounds) return floor.bounds;
  return { minX: 0, minY: 0, maxX: 10, maxY: 10 };
}

/**
 * Builds a clean, layered architectural SVG document for a floor plan.
 * Coordinates are in meters (1 SVG unit = 1 meter, with viewBox padded around plan).
 * @param {{ projectName?: string, floor: Object, units?: 'imperial'|'metric', showRooms?: boolean, showNorth?: boolean, northAngle?: number }} opts
 * @returns {string}
 */
export function buildSVG({ projectName = 'Floor Plan', floor, units = 'imperial', showRooms = true, showNorth = false, northAngle = 0 }) {
  const walls = floor?.walls || floor?.segments || [];
  const rooms = floor?.rooms || [];
  const symbols = floor?.symbols || [];
  const measurements = floor?.measurements || [];
  const textNotes = floor?.textNotes || [];
  const bounds = getBoundsFallback(floor);

  const dataW = Math.max(1, bounds.maxX - bounds.minX);
  const dataH = Math.max(1, bounds.maxY - bounds.minY);
  const pad = Math.max(0.8, Math.min(2.5, Math.max(dataW, dataH) * 0.14));
  const vbX = bounds.minX - pad;
  const vbY = bounds.minY - pad;
  const vbW = dataW + pad * 2;
  const vbH = dataH + pad * 2;

  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX.toFixed(4)} ${vbY.toFixed(4)} ${vbW.toFixed(4)} ${vbH.toFixed(4)}" width="${Math.round(vbW * 80)}" height="${Math.round(vbH * 80)}">`
  );
  lines.push(`  <title>${escapeXml(projectName)} — ${escapeXml(floor?.name || 'Floor 1')}</title>`);
  lines.push(`  <rect x="${vbX.toFixed(4)}" y="${vbY.toFixed(4)}" width="${vbW.toFixed(4)}" height="${vbH.toFixed(4)}" fill="#ffffff" />`);

  // Rooms layer
  if (showRooms && rooms.length > 0) {
    const fills = ['#f1f5f9', '#ecfdf5', '#f5f3ff', '#fffbeb'];
    lines.push('  <g id="rooms">');
    rooms.forEach((room, idx) => {
      if (!room.polygon || room.polygon.length < 3) return;
      const pts = room.polygon.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(' ');
      lines.push(`    <polygon points="${pts}" fill="${fills[idx % fills.length]}" stroke="none" />`);
    });
    lines.push('  </g>');
  }

  // Walls layer
  lines.push('  <g id="walls" stroke="#0f172a" stroke-width="0.08" stroke-linecap="round" fill="none">');
  for (const [a, b] of walls) {
    lines.push(`    <line x1="${a[0].toFixed(4)}" y1="${a[1].toFixed(4)}" x2="${b[0].toFixed(4)}" y2="${b[1].toFixed(4)}" />`);
  }
  lines.push('  </g>');

  // Architectural symbols (doors, windows, archways, stairs)
  if (symbols.length > 0) {
    lines.push('  <g id="symbols">');
    for (const sym of symbols) {
      const angle = sym.angle || 0;
      const swing = sym.swing === -1 ? -1 : 1;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);

      if (sym.kind === 'stairs') {
        const width = sym.width || 1.0;
        const length = sym.length || 2.8;
        const hw = width * 0.5;
        const hl = length * 0.5;
        const vx = -uy;
        const vy = ux;
        const pt = (u, v) => [sym.pos[0] + ux * u + vx * v, sym.pos[1] + uy * u + vy * v];
        const corners = [pt(-hl, -hw), pt(hl, -hw), pt(hl, hw), pt(-hl, hw)];
        lines.push(`    <polygon points="${corners.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(' ')}" fill="#ffffff" stroke="#0f172a" stroke-width="0.045" />`);

        const numTreads = Math.max(4, Math.min(18, Math.round(length / 0.28)));
        for (let t = 1; t < numTreads; t++) {
          const f = -hl + (t / numTreads) * length;
          const [t1x, t1y] = pt(f, -hw);
          const [t2x, t2y] = pt(f, hw);
          lines.push(`    <line x1="${t1x.toFixed(4)}" y1="${t1y.toFixed(4)}" x2="${t2x.toFixed(4)}" y2="${t2y.toFixed(4)}" stroke="#64748b" stroke-width="0.025" />`);
        }

        const [a0x, a0y] = pt(-swing * hl * 0.72, 0);
        const [a1x, a1y] = pt(swing * hl * 0.72, 0);
        const headLen = Math.min(0.24, width * 0.28);
        const [h1x, h1y] = pt(swing * hl * 0.72 - swing * headLen, headLen * 0.7);
        const [h2x, h2y] = pt(swing * hl * 0.72 - swing * headLen, -headLen * 0.7);
        lines.push(`    <line x1="${a0x.toFixed(4)}" y1="${a0y.toFixed(4)}" x2="${a1x.toFixed(4)}" y2="${a1y.toFixed(4)}" stroke="#0f172a" stroke-width="0.04" />`);
        lines.push(`    <line x1="${a1x.toFixed(4)}" y1="${a1y.toFixed(4)}" x2="${h1x.toFixed(4)}" y2="${h1y.toFixed(4)}" stroke="#0f172a" stroke-width="0.04" />`);
        lines.push(`    <line x1="${a1x.toFixed(4)}" y1="${a1y.toFixed(4)}" x2="${h2x.toFixed(4)}" y2="${h2y.toFixed(4)}" stroke="#0f172a" stroke-width="0.04" />`);

        const [lx, ly] = pt(-swing * hl * 0.22, 0);
        lines.push(`    <text x="${lx.toFixed(4)}" y="${ly.toFixed(4)}" font-size="0.22" font-weight="700" font-family="sans-serif" text-anchor="middle" dominant-baseline="central" fill="#0f172a">UP</text>`);
        continue;
      }

      const width = sym.width || (sym.kind === 'door' ? 0.9 : 1.2);
      const half = width * 0.5;
      const nx = -uy * swing;
      const ny = ux * swing;
      const x1 = sym.pos[0] - ux * half;
      const y1 = sym.pos[1] - uy * half;
      const x2 = sym.pos[0] + ux * half;
      const y2 = sym.pos[1] + uy * half;

      // White break over underlying wall
      lines.push(`    <line x1="${x1.toFixed(4)}" y1="${y1.toFixed(4)}" x2="${x2.toFixed(4)}" y2="${y2.toFixed(4)}" stroke="#ffffff" stroke-width="0.14" />`);

      if (sym.kind === 'archway') {
        const jx = -uy * 0.08;
        const jy = ux * 0.08;
        lines.push(`    <line x1="${(x1 - jx).toFixed(4)}" y1="${(y1 - jy).toFixed(4)}" x2="${(x1 + jx).toFixed(4)}" y2="${(y1 + jy).toFixed(4)}" stroke="#0f172a" stroke-width="0.04" />`);
        lines.push(`    <line x1="${(x2 - jx).toFixed(4)}" y1="${(y2 - jy).toFixed(4)}" x2="${(x2 + jx).toFixed(4)}" y2="${(y2 + jy).toFixed(4)}" stroke="#0f172a" stroke-width="0.04" />`);
        lines.push(`    <line x1="${x1.toFixed(4)}" y1="${y1.toFixed(4)}" x2="${x2.toFixed(4)}" y2="${y2.toFixed(4)}" stroke="#64748b" stroke-width="0.025" stroke-dasharray="0.08 0.06" />`);
      } else if (sym.kind === 'window') {
        const px = -uy * 0.05;
        const py = ux * 0.05;
        lines.push(`    <line x1="${(x1 - px).toFixed(4)}" y1="${(y1 - py).toFixed(4)}" x2="${(x2 - px).toFixed(4)}" y2="${(y2 - py).toFixed(4)}" stroke="#0f172a" stroke-width="0.03" />`);
        lines.push(`    <line x1="${(x1 + px).toFixed(4)}" y1="${(y1 + py).toFixed(4)}" x2="${(x2 + px).toFixed(4)}" y2="${(y2 + py).toFixed(4)}" stroke="#0f172a" stroke-width="0.03" />`);
        lines.push(`    <line x1="${x1.toFixed(4)}" y1="${y1.toFixed(4)}" x2="${x2.toFixed(4)}" y2="${y2.toFixed(4)}" stroke="#2563eb" stroke-width="0.025" />`);
      } else {
        const tx = x1 + nx * width;
        const ty = y1 + ny * width;
        const sweepFlag = swing === 1 ? 0 : 1;
        lines.push(`    <line x1="${x1.toFixed(4)}" y1="${y1.toFixed(4)}" x2="${tx.toFixed(4)}" y2="${ty.toFixed(4)}" stroke="#0f172a" stroke-width="0.045" />`);
        lines.push(`    <path d="M ${tx.toFixed(4)} ${ty.toFixed(4)} A ${width.toFixed(4)} ${width.toFixed(4)} 0 0 ${sweepFlag} ${x2.toFixed(4)} ${y2.toFixed(4)}" fill="none" stroke="#64748b" stroke-width="0.025" stroke-dasharray="0.08 0.06" />`);
      }
    }
    lines.push('  </g>');
  }

  // Dimensions layer
  const dimOff = Math.max(0.3, Math.min(1.0, Math.min(dataW, dataH) * 0.1));
  const fontSize = Math.max(0.14, Math.min(0.32, Math.min(dataW, dataH) * 0.05));
  lines.push('  <g id="dimensions" stroke="#64748b" stroke-width="0.02" fill="#475569" font-family="sans-serif">');
  lines.push(`    <line x1="${bounds.minX.toFixed(4)}" y1="${(bounds.maxY + dimOff).toFixed(4)}" x2="${bounds.maxX.toFixed(4)}" y2="${(bounds.maxY + dimOff).toFixed(4)}" />`);
  lines.push(`    <text x="${((bounds.minX + bounds.maxX) / 2).toFixed(4)}" y="${(bounds.maxY + dimOff + fontSize * 1.2).toFixed(4)}" font-size="${fontSize.toFixed(3)}" text-anchor="middle" stroke="none">${escapeXml(formatDistance(dataW, units))}</text>`);
  lines.push(`    <line x1="${(bounds.maxX + dimOff).toFixed(4)}" y1="${bounds.minY.toFixed(4)}" x2="${(bounds.maxX + dimOff).toFixed(4)}" y2="${bounds.maxY.toFixed(4)}" />`);
  const hx = bounds.maxX + dimOff + fontSize * 1.2;
  const hy = (bounds.minY + bounds.maxY) / 2;
  lines.push(`    <text x="${hx.toFixed(4)}" y="${hy.toFixed(4)}" font-size="${fontSize.toFixed(3)}" text-anchor="middle" stroke="none" transform="rotate(-90 ${hx.toFixed(4)} ${hy.toFixed(4)})">${escapeXml(formatDistance(dataH, units))}</text>`);

  for (const m of measurements) {
    const mx = (m.p1[0] + m.p2[0]) / 2;
    const my = (m.p1[1] + m.p2[1]) / 2;
    lines.push(`    <line x1="${m.p1[0].toFixed(4)}" y1="${m.p1[1].toFixed(4)}" x2="${m.p2[0].toFixed(4)}" y2="${m.p2[1].toFixed(4)}" stroke="#2563eb" />`);
    lines.push(`    <text x="${mx.toFixed(4)}" y="${(my - fontSize * 0.4).toFixed(4)}" font-size="${fontSize.toFixed(3)}" text-anchor="middle" fill="#1e3a8a" stroke="none">${escapeXml(m.text)}</text>`);
  }
  lines.push('  </g>');

  // Room labels & Notes layer
  lines.push('  <g id="notes" font-family="sans-serif" text-anchor="middle">');
  if (showRooms) {
    for (const room of rooms) {
      if (!room.centroid) continue;
      const hasNote = textNotes.some(
        (n) => Array.isArray(n.pos) && n.text && n.text.trim() && room.polygon && pointInPolygon(n.pos, room.polygon)
      );
      if (!hasNote) {
        lines.push(`    <text x="${room.centroid[0].toFixed(4)}" y="${(room.centroid[1] - fontSize * 0.3).toFixed(4)}" font-size="${(fontSize * 1.05).toFixed(3)}" font-weight="600" fill="#1e293b">${escapeXml(room.displayName || room.name)}</text>`);
      }
      lines.push(`    <text x="${room.centroid[0].toFixed(4)}" y="${(room.centroid[1] + (hasNote ? fontSize * 1.3 : fontSize * 0.9)).toFixed(4)}" font-size="${(fontSize * 0.85).toFixed(3)}" fill="#64748b">${escapeXml(formatArea(room.area, units))}</text>`);
    }
  }
  for (const n of textNotes) {
    lines.push(`    <text x="${n.pos[0].toFixed(4)}" y="${n.pos[1].toFixed(4)}" font-size="${(fontSize * 1.1).toFixed(3)}" font-weight="600" fill="#0f172a">${escapeXml(n.text)}</text>`);
  }
  lines.push('  </g>');

  if (showNorth) {
    const r = Math.max(0.28, Math.min(0.5, Math.min(dataW, dataH) * 0.06));
    const nx = vbX + vbW - pad * 0.5;
    const ny = vbY + pad * 0.5;
    lines.push(`  <g id="north-arrow" transform="rotate(${northAngle} ${nx.toFixed(4)} ${ny.toFixed(4)})">`);
    lines.push(`    <circle cx="${nx.toFixed(4)}" cy="${ny.toFixed(4)}" r="${r.toFixed(4)}" fill="none" stroke="#0f172a" stroke-width="0.025" />`);
    lines.push(`    <polygon points="${nx.toFixed(4)},${(ny - r * 0.85).toFixed(4)} ${(nx - r * 0.35).toFixed(4)},${(ny + r * 0.4).toFixed(4)} ${nx.toFixed(4)},${(ny + r * 0.15).toFixed(4)}" fill="#0f172a" />`);
    lines.push(`    <polygon points="${nx.toFixed(4)},${(ny - r * 0.85).toFixed(4)} ${(nx + r * 0.35).toFixed(4)},${(ny + r * 0.4).toFixed(4)} ${nx.toFixed(4)},${(ny + r * 0.15).toFixed(4)}" fill="none" stroke="#0f172a" stroke-width="0.02" />`);
    lines.push(`    <text x="${nx.toFixed(4)}" y="${(ny - r * 1.15).toFixed(4)}" font-size="${(r * 0.7).toFixed(3)}" font-weight="700" font-family="sans-serif" text-anchor="middle" fill="#0f172a">N</text>`);
    lines.push('  </g>');
  }

  lines.push('</svg>');
  return lines.join('\n');
}

/**
 * Builds an AutoCAD R12 (AC1009) ASCII DXF document with layers for Walls, Doors, Windows,
 * Rooms, Dimensions, and Notes. Y is negated (-y) so CAD top-down matches the 2D view.
 * @param {{ floor: Object, units?: 'imperial'|'metric' }} opts
 * @returns {string}
 */
export function buildDXF({ floor, units = 'imperial' }) {
  const walls = floor?.walls || floor?.segments || [];
  const rooms = floor?.rooms || [];
  const symbols = floor?.symbols || [];
  const measurements = floor?.measurements || [];
  const textNotes = floor?.textNotes || [];

  const scaleFactor = units === 'metric' ? 1 : METERS_TO_FEET;
  const insUnits = units === 'metric' ? 6 : 2; // 6 = meters, 2 = feet
  const textHeight = (units === 'metric' ? 0.22 : 0.72).toFixed(4);
  const toX = (x) => (x * scaleFactor).toFixed(4);
  const toY = (y) => (-y * scaleFactor).toFixed(4);

  const out = [];
  const pushPair = (code, val) => {
    out.push(String(code), String(val));
  };

  // HEADER
  pushPair(0, 'SECTION');
  pushPair(2, 'HEADER');
  pushPair(9, '$ACADVER');
  pushPair(1, 'AC1009');
  pushPair(9, '$INSUNITS');
  pushPair(70, insUnits);
  pushPair(0, 'ENDSEC');

  // TABLES -> LAYERS
  const layers = [
    ['WALLS', 7],
    ['DOORS', 3],
    ['WINDOWS', 5],
    ['OPENINGS', 6],
    ['STAIRS', 1],
    ['ROOMS', 4],
    ['DIMENSIONS', 8],
    ['NOTES', 2],
  ];
  pushPair(0, 'SECTION');
  pushPair(2, 'TABLES');
  pushPair(0, 'TABLE');
  pushPair(2, 'LAYER');
  pushPair(70, layers.length);
  for (const [name, color] of layers) {
    pushPair(0, 'LAYER');
    pushPair(2, name);
    pushPair(70, 0);
    pushPair(62, color);
    pushPair(6, 'CONTINUOUS');
  }
  pushPair(0, 'ENDTAB');
  pushPair(0, 'ENDSEC');

  // ENTITIES
  pushPair(0, 'SECTION');
  pushPair(2, 'ENTITIES');

  const emitLine = (layer, x1, y1, x2, y2) => {
    pushPair(0, 'LINE');
    pushPair(8, layer);
    pushPair(10, toX(x1));
    pushPair(20, toY(y1));
    pushPair(30, 0);
    pushPair(11, toX(x2));
    pushPair(21, toY(y2));
    pushPair(31, 0);
  };

  const emitText = (layer, x, y, text) => {
    pushPair(0, 'TEXT');
    pushPair(8, layer);
    pushPair(10, toX(x));
    pushPair(20, toY(y));
    pushPair(30, 0);
    pushPair(40, textHeight);
    pushPair(1, String(text));
  };

  // Walls
  for (const [a, b] of walls) {
    emitLine('WALLS', a[0], a[1], b[0], b[1]);
  }

  // Doors, Windows, Archways & Stairs
  for (const sym of symbols) {
    const angle = sym.angle || 0;
    const swing = sym.swing === -1 ? -1 : 1;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);

    if (sym.kind === 'stairs') {
      const width = sym.width || 1.0;
      const length = sym.length || 2.8;
      const hw = width * 0.5;
      const hl = length * 0.5;
      const vx = -uy;
      const vy = ux;
      const pt = (u, v) => [sym.pos[0] + ux * u + vx * v, sym.pos[1] + uy * u + vy * v];
      const [c1, c2, c3, c4] = [pt(-hl, -hw), pt(hl, -hw), pt(hl, hw), pt(-hl, hw)];

      emitLine('STAIRS', c1[0], c1[1], c2[0], c2[1]);
      emitLine('STAIRS', c2[0], c2[1], c3[0], c3[1]);
      emitLine('STAIRS', c3[0], c3[1], c4[0], c4[1]);
      emitLine('STAIRS', c4[0], c4[1], c1[0], c1[1]);

      const numTreads = Math.max(4, Math.min(18, Math.round(length / 0.28)));
      for (let t = 1; t < numTreads; t++) {
        const f = -hl + (t / numTreads) * length;
        const t1 = pt(f, -hw);
        const t2 = pt(f, hw);
        emitLine('STAIRS', t1[0], t1[1], t2[0], t2[1]);
      }

      const a0 = pt(-swing * hl * 0.72, 0);
      const a1 = pt(swing * hl * 0.72, 0);
      const headLen = Math.min(0.24, width * 0.28);
      const h1 = pt(swing * hl * 0.72 - swing * headLen, headLen * 0.7);
      const h2 = pt(swing * hl * 0.72 - swing * headLen, -headLen * 0.7);
      emitLine('STAIRS', a0[0], a0[1], a1[0], a1[1]);
      emitLine('STAIRS', a1[0], a1[1], h1[0], h1[1]);
      emitLine('STAIRS', a1[0], a1[1], h2[0], h2[1]);

      const lbl = pt(-swing * hl * 0.22, 0);
      emitText('STAIRS', lbl[0], lbl[1], 'UP');
      continue;
    }

    const width = sym.width || (sym.kind === 'door' ? 0.9 : 1.2);
    const half = width * 0.5;
    const nx = -uy * swing;
    const ny = ux * swing;

    const hx = sym.pos[0] - ux * half;
    const hy = sym.pos[1] - uy * half;
    const lx = sym.pos[0] + ux * half;
    const ly = sym.pos[1] + uy * half;

    if (sym.kind === 'archway') {
      const jx = -uy * 0.08;
      const jy = ux * 0.08;
      emitLine('OPENINGS', hx - jx, hy - jy, hx + jx, hy + jy);
      emitLine('OPENINGS', lx - jx, ly - jy, lx + jx, ly + jy);
      emitLine('OPENINGS', hx, hy, lx, ly);
    } else if (sym.kind === 'window') {
      const px = -uy * 0.05;
      const py = ux * 0.05;
      emitLine('WINDOWS', hx - px, hy - py, lx - px, ly - py);
      emitLine('WINDOWS', hx + px, hy + py, lx + px, ly + py);
      emitLine('WINDOWS', hx, hy, lx, ly);
    } else {
      const tx = hx + nx * width;
      const ty = hy + ny * width;
      emitLine('DOORS', hx, hy, tx, ty);

      // Compute CCW start/end angles in DXF Y-flipped coordinates
      const normDeg = (deg) => ((deg % 360) + 360) % 360;
      const aLatch = normDeg((Math.atan2(-(ly - hy), lx - hx) * 180) / Math.PI);
      const aTip = normDeg((Math.atan2(-(ty - hy), tx - hx) * 180) / Math.PI);
      const ccwSpan = normDeg(aTip - aLatch);
      const startAngle = ccwSpan <= 180 ? aLatch : aTip;
      const endAngle = ccwSpan <= 180 ? aTip : aLatch;

      pushPair(0, 'ARC');
      pushPair(8, 'DOORS');
      pushPair(10, toX(hx));
      pushPair(20, toY(hy));
      pushPair(30, 0);
      pushPair(40, (width * scaleFactor).toFixed(4));
      pushPair(50, startAngle.toFixed(2));
      pushPair(51, endAngle.toFixed(2));
    }
  }

  // Measurements
  for (const m of measurements) {
    emitLine('DIMENSIONS', m.p1[0], m.p1[1], m.p2[0], m.p2[1]);
    emitText('DIMENSIONS', (m.p1[0] + m.p2[0]) * 0.5, (m.p1[1] + m.p2[1]) * 0.5, m.text);
  }

  // Rooms & Notes
  for (const room of rooms) {
    if (!room.centroid) continue;
    emitText('ROOMS', room.centroid[0], room.centroid[1], `${room.displayName || room.name} (${formatArea(room.area, units)})`);
  }
  for (const n of textNotes) {
    emitText('NOTES', n.pos[0], n.pos[1], n.text);
  }

  pushPair(0, 'ENDSEC');
  pushPair(0, 'EOF');

  return out.join('\n');
}

/**
 * Triggers a client-side file save for SVG or DXF text exports.
 */
export async function saveTextFile(content, fileName, mimeType, description, extension) {
  const blob = new Blob([content], { type: mimeType });

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description, accept: { [mimeType]: [extension] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { success: true, method: 'filesystem' };
    } catch (err) {
      if (err.name === 'AbortError') return { success: false, cancelled: true };
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

/**
 * Renders an SVG DOM element (such as the live blueprint sheet preview) to a high-DPI PNG file.
 * @param {SVGSVGElement} svgElement
 * @param {string} fileName
 * @param {{ targetWidth?: number }} [options]
 */
export async function exportSVGElementToPNG(svgElement, fileName = 'floorplan.png', { targetWidth = 2400 } = {}) {
  if (!svgElement) throw new Error('No blueprint SVG available to render.');

  const clone = svgElement.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const vb = svgElement.viewBox?.baseVal;
  const aspect = (vb && vb.width > 0 && vb.height > 0) ? vb.height / vb.width : 1 / 1.414;
  const width = Math.max(800, targetWidth);
  const height = Math.round(width * aspect);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const xml = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to rasterize blueprint SVG.'));
      image.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))), 'image/png');
    });

    if ('showSaveFilePicker' in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(pngBlob);
        await writable.close();
        return { success: true, method: 'filesystem' };
      } catch (err) {
        if (err.name === 'AbortError') return { success: false, cancelled: true };
      }
    }

    const url = URL.createObjectURL(pngBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { success: true, method: 'download' };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
