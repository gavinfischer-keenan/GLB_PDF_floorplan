/**
 * Live Blueprint SVG Preview (Step 4)
 * Renders an accurate vector preview matching PDF export output, or a helpful empty state.
 */
import { getPaperDimensions, formatScaleLabel, computeBlueprintScale, computeScaleBar } from '../utils/blueprint-layout.js';
import { formatDistance, formatArea, pointInPolygon } from '../utils/geometry.js';
import { renderEmptyState } from './empty-states.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, textContent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  if (textContent !== null) {
    el.textContent = textContent;
  }
  return el;
}

/**
 * Render the Step 4 blueprint preview SVG into `#export-preview`.
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {Object|null} opts.floor
 * @param {string} opts.projectName
 * @param {string} opts.paperSize
 * @param {'auto'|number|string} opts.scale
 * @param {'imperial'|'metric'} opts.units
 * @param {() => void} opts.onLoadSample
 * @param {() => void} opts.onGoToEditor
 */
export function renderBlueprintPreview(container, opts) {
  if (!container) return;

  const {
    floor,
    projectName = 'Floor Plan',
    paperSize = 'a3',
    orientation = 'landscape',
    scale: requestedScale = 'auto',
    units = 'imperial',
    showRooms = true,
    showNorth = true,
    northAngle = 0,
    includeRoomSchedule = false,
    metadata = {},
    pageIndex = 0,
    totalPages = 1,
    onLoadSample,
    onGoToEditor,
  } = opts;

  const walls = floor?.walls || floor?.segments || [];
  const measurements = floor?.measurements || [];
  const textNotes = floor?.textNotes || [];
  const symbols = floor?.symbols || [];
  const rooms = floor?.rooms || [];
  const bounds = floor?.bounds;

  const hasContent = Boolean(bounds && (walls.length > 0 || measurements.length > 0 || textNotes.length > 0));

  if (!hasContent) {
    container.classList.add('is-empty');
    container.style.aspectRatio = orientation === 'portrait' ? '0.707' : '1.414';
    renderEmptyState(container, {
      title: 'No Floor Plan Ready for Preview',
      description: 'This preview displays your scaled blueprint sheet, dimension lines, and title block once walls are present.',
      actionLabel: 'Load Sample House Plan',
      onAction: onLoadSample,
      secondaryLabel: 'Draw Walls in Editor',
      onSecondary: onGoToEditor,
    });
    return;
  }

  container.classList.remove('is-empty');
  container.innerHTML = '';

  const paper = getPaperDimensions(paperSize, orientation);
  container.style.aspectRatio = `${paper.width} / ${paper.height}`;

  const baseMargin = { top: 20, right: 20, bottom: 35, left: 20 };
  const hasSchedule = Boolean(includeRoomSchedule && rooms.length > 0);
  const scheduleWidth = 58;
  const scheduleGap = 4;
  const margin = hasSchedule
    ? { ...baseMargin, right: baseMargin.right + scheduleWidth + scheduleGap }
    : baseMargin;

  const { scale, drawWidth, drawHeight, dataWidth, dataHeight } = computeBlueprintScale(
    bounds,
    paper,
    margin,
    requestedScale === 'auto' ? 'auto' : Number(requestedScale),
    units
  );

  const outerWidth = paper.width - baseMargin.left - baseMargin.right;
  const outerHeight = paper.height - baseMargin.top - baseMargin.bottom;

  const mmPerMeter = 1000 / scale;
  const drawingWidth = dataWidth * mmPerMeter;
  const drawingHeight = dataHeight * mmPerMeter;
  const offsetX = margin.left + (drawWidth - drawingWidth) / 2;
  const offsetY = margin.top + (drawHeight - drawingHeight) / 2;

  const toPage = (x, y) => ({
    x: offsetX + (x - bounds.minX) * mmPerMeter,
    y: offsetY + (y - bounds.minY) * mmPerMeter,
  });

  const svg = svgEl('svg', {
    viewBox: `0 0 ${paper.width} ${paper.height}`,
    class: 'blueprint-preview-svg',
    role: 'img',
    'aria-label': `Blueprint preview for ${projectName || 'Floor Plan'}`,
  });

  // Paper background
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: paper.width, height: paper.height, fill: '#ffffff' }));

  // Clip drawing region inside border so large custom scales stay neat
  const defs = svgEl('defs');
  const clip = svgEl('clipPath', { id: 'blueprint-draw-clip' });
  clip.appendChild(svgEl('rect', {
    x: margin.left - 5,
    y: margin.top - 5,
    width: drawWidth + 10,
    height: drawHeight + 10,
  }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  // Outer blueprint border
  svg.appendChild(svgEl('rect', {
    x: baseMargin.left - 5,
    y: baseMargin.top - 5,
    width: outerWidth + 10,
    height: outerHeight + 10,
    fill: 'none',
    stroke: '#0f172a',
    'stroke-width': 0.5,
  }));

  const drawingGroup = svgEl('g', { 'clip-path': 'url(#blueprint-draw-clip)' });

  // Room fills
  if (showRooms && rooms.length > 0) {
    const fills = ['#f1f5f9', '#ecfdf5', '#f5f3ff', '#fffbeb'];
    rooms.forEach((room, rIdx) => {
      if (!room.polygon || room.polygon.length < 3) return;
      const pts = room.polygon
        .map(([x, y]) => {
          const p = toPage(x, y);
          return `${p.x},${p.y}`;
        })
        .join(' ');
      drawingGroup.appendChild(svgEl('polygon', { points: pts, fill: fills[rIdx % fills.length] }));
    });
  }

  // Walls
  for (const seg of walls) {
    const p1 = toPage(seg[0][0], seg[0][1]);
    const p2 = toPage(seg[1][0], seg[1][1]);
    drawingGroup.appendChild(svgEl('line', {
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      stroke: '#0f172a',
      'stroke-width': 0.7,
      'stroke-linecap': 'round',
    }));
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
      const pt = (u, v) => toPage(sym.pos[0] + ux * u + vx * v, sym.pos[1] + uy * u + vy * v);

      const corners = [pt(-hl, -hw), pt(hl, -hw), pt(hl, hw), pt(-hl, hw)];
      drawingGroup.appendChild(svgEl('polygon', {
        points: corners.map((c) => `${c.x},${c.y}`).join(' '),
        fill: '#ffffff', stroke: '#0f172a', 'stroke-width': 0.35,
      }));

      const numTreads = Math.max(4, Math.min(18, Math.round(length / 0.28)));
      for (let t = 1; t < numTreads; t++) {
        const f = -hl + (t / numTreads) * length;
        const t1 = pt(f, -hw);
        const t2 = pt(f, hw);
        drawingGroup.appendChild(svgEl('line', {
          x1: t1.x, y1: t1.y, x2: t2.x, y2: t2.y,
          stroke: '#64748b', 'stroke-width': 0.2,
        }));
      }

      const a0 = pt(-swing * hl * 0.72, 0);
      const a1 = pt(swing * hl * 0.72, 0);
      const headLen = Math.min(0.24, width * 0.28);
      const h1 = pt(swing * hl * 0.72 - swing * headLen, headLen * 0.7);
      const h2 = pt(swing * hl * 0.72 - swing * headLen, -headLen * 0.7);

      drawingGroup.appendChild(svgEl('line', { x1: a0.x, y1: a0.y, x2: a1.x, y2: a1.y, stroke: '#0f172a', 'stroke-width': 0.35 }));
      drawingGroup.appendChild(svgEl('line', { x1: a1.x, y1: a1.y, x2: h1.x, y2: h1.y, stroke: '#0f172a', 'stroke-width': 0.35 }));
      drawingGroup.appendChild(svgEl('line', { x1: a1.x, y1: a1.y, x2: h2.x, y2: h2.y, stroke: '#0f172a', 'stroke-width': 0.35 }));

      const lblPt = pt(-swing * hl * 0.22, 0);
      drawingGroup.appendChild(svgEl('text', {
        x: lblPt.x, y: lblPt.y,
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': 2.5, 'font-weight': 700, 'font-family': 'sans-serif', fill: '#0f172a',
      }, 'UP'));
      continue;
    }

    const width = sym.width || (sym.kind === 'door' ? 0.9 : 1.2);
    const half = width * 0.5;
    const nx = -uy * swing;
    const ny = ux * swing;
    const p1 = toPage(sym.pos[0] - ux * half, sym.pos[1] - uy * half);
    const p2 = toPage(sym.pos[0] + ux * half, sym.pos[1] + uy * half);

    drawingGroup.appendChild(svgEl('line', {
      x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      stroke: '#ffffff', 'stroke-width': 1.2,
    }));

    if (sym.kind === 'archway') {
      const jamb = Math.max(0.7, 0.08 * mmPerMeter);
      const jx = -uy * jamb;
      const jy = ux * jamb;
      drawingGroup.appendChild(svgEl('line', { x1: p1.x - jx, y1: p1.y - jy, x2: p1.x + jx, y2: p1.y + jy, stroke: '#0f172a', 'stroke-width': 0.35 }));
      drawingGroup.appendChild(svgEl('line', { x1: p2.x - jx, y1: p2.y - jy, x2: p2.x + jx, y2: p2.y + jy, stroke: '#0f172a', 'stroke-width': 0.35 }));
      drawingGroup.appendChild(svgEl('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: '#64748b', 'stroke-width': 0.22, 'stroke-dasharray': '1.2 1' }));
    } else if (sym.kind === 'window') {
      const px = -uy * 0.35;
      const py = ux * 0.35;
      drawingGroup.appendChild(svgEl('line', { x1: p1.x - px, y1: p1.y - py, x2: p2.x - px, y2: p2.y - py, stroke: '#0f172a', 'stroke-width': 0.25 }));
      drawingGroup.appendChild(svgEl('line', { x1: p1.x + px, y1: p1.y + py, x2: p2.x + px, y2: p2.y + py, stroke: '#0f172a', 'stroke-width': 0.25 }));
      drawingGroup.appendChild(svgEl('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: '#2563eb', 'stroke-width': 0.2 }));
    } else {
      const pTip = toPage(sym.pos[0] - ux * half + nx * width, sym.pos[1] - uy * half + ny * width);
      const rMm = width * mmPerMeter;
      const sweepFlag = swing === 1 ? 0 : 1;
      drawingGroup.appendChild(svgEl('line', { x1: p1.x, y1: p1.y, x2: pTip.x, y2: pTip.y, stroke: '#0f172a', 'stroke-width': 0.45 }));
      drawingGroup.appendChild(svgEl('path', {
        d: `M ${pTip.x} ${pTip.y} A ${rMm} ${rMm} 0 0 ${sweepFlag} ${p2.x} ${p2.y}`,
        fill: 'none', stroke: '#64748b', 'stroke-width': 0.22, 'stroke-dasharray': '1.2 1',
      }));
    }
  }

  // Room labels & areas
  if (showRooms && rooms.length > 0) {
    for (const room of rooms) {
      if (!room.centroid) continue;
      const c = toPage(room.centroid[0], room.centroid[1]);
      const hasManualNote = textNotes.some(
        (n) => Array.isArray(n.pos) && n.text && n.text.trim() && room.polygon && pointInPolygon(n.pos, room.polygon)
      );
      if (!hasManualNote) {
        drawingGroup.appendChild(svgEl('text', {
          x: c.x,
          y: c.y - 1.2,
          'text-anchor': 'middle',
          'font-size': 3.6,
          'font-weight': 600,
          'font-family': 'sans-serif',
          fill: '#1e293b',
        }, room.displayName || room.name || 'Room'));
      }
      drawingGroup.appendChild(svgEl('text', {
        x: c.x,
        y: hasManualNote ? c.y + 4.2 : c.y + 2.6,
        'text-anchor': 'middle',
        'font-size': 3.0,
        'font-family': 'sans-serif',
        fill: '#64748b',
      }, formatArea(room.area, units)));
    }
  }

  // Overall dimensions
  const dimOffset = 0.3;
  const tickH = 1.2;
  const wP1 = toPage(bounds.minX, bounds.maxY + dimOffset);
  const wP2 = toPage(bounds.maxX, bounds.maxY + dimOffset);
  drawingGroup.appendChild(svgEl('line', { x1: wP1.x, y1: wP1.y, x2: wP2.x, y2: wP2.y, stroke: '#64748b', 'stroke-width': 0.25 }));
  drawingGroup.appendChild(svgEl('line', { x1: wP1.x, y1: wP1.y - tickH, x2: wP1.x, y2: wP1.y + tickH, stroke: '#64748b', 'stroke-width': 0.25 }));
  drawingGroup.appendChild(svgEl('line', { x1: wP2.x, y1: wP2.y - tickH, x2: wP2.x, y2: wP2.y + tickH, stroke: '#64748b', 'stroke-width': 0.25 }));
  const wMid = toPage((bounds.minX + bounds.maxX) / 2, bounds.maxY + dimOffset);
  drawingGroup.appendChild(svgEl('text', {
    x: wMid.x,
    y: wMid.y + 4,
    'text-anchor': 'middle',
    'font-size': 3.5,
    'font-family': 'sans-serif',
    fill: '#475569',
  }, formatDistance(dataWidth, units)));

  const hP1 = toPage(bounds.maxX + dimOffset, bounds.minY);
  const hP2 = toPage(bounds.maxX + dimOffset, bounds.maxY);
  drawingGroup.appendChild(svgEl('line', { x1: hP1.x, y1: hP1.y, x2: hP2.x, y2: hP2.y, stroke: '#64748b', 'stroke-width': 0.25 }));
  drawingGroup.appendChild(svgEl('line', { x1: hP1.x - tickH, y1: hP1.y, x2: hP1.x + tickH, y2: hP1.y, stroke: '#64748b', 'stroke-width': 0.25 }));
  drawingGroup.appendChild(svgEl('line', { x1: hP2.x - tickH, y1: hP2.y, x2: hP2.x + tickH, y2: hP2.y, stroke: '#64748b', 'stroke-width': 0.25 }));
  const hMid = toPage(bounds.maxX + dimOffset, (bounds.minY + bounds.maxY) / 2);
  drawingGroup.appendChild(svgEl('text', {
    x: hMid.x + 4,
    y: hMid.y,
    'text-anchor': 'middle',
    'font-size': 3.5,
    'font-family': 'sans-serif',
    fill: '#475569',
    transform: `rotate(-90 ${hMid.x + 4} ${hMid.y})`,
  }, formatDistance(dataHeight, units)));

  // User measurements
  for (const m of measurements) {
    const mP1 = toPage(m.p1[0], m.p1[1]);
    const mP2 = toPage(m.p2[0], m.p2[1]);
    drawingGroup.appendChild(svgEl('line', { x1: mP1.x, y1: mP1.y, x2: mP2.x, y2: mP2.y, stroke: '#2563eb', 'stroke-width': 0.3 }));
    const mMid = toPage((m.p1[0] + m.p2[0]) / 2, (m.p1[1] + m.p2[1]) / 2);
    drawingGroup.appendChild(svgEl('text', {
      x: mMid.x,
      y: mMid.y - 1.5,
      'text-anchor': 'middle',
      'font-size': 3.6,
      'font-family': 'sans-serif',
      fill: '#1e3a8a',
    }, m.text));
  }

  // User text notes
  for (const note of textNotes) {
    const pt = toPage(note.pos[0], note.pos[1]);
    drawingGroup.appendChild(svgEl('text', {
      x: pt.x,
      y: pt.y,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 4.4,
      'font-weight': 600,
      'font-family': 'sans-serif',
      fill: '#1e293b',
    }, note.text));
  }

  svg.appendChild(drawingGroup);

  // Room Schedule Table on right side
  if (hasSchedule) {
    const schedX = paper.width - baseMargin.right - scheduleWidth + 2;
    const schedW = scheduleWidth - 2;
    const rowH = 5.5;
    const headerH = 7;
    const maxRows = Math.max(1, Math.floor((outerHeight - 10 - headerH - rowH - 2) / rowH));
    const visibleRooms = rooms.slice(0, maxRows);
    const totalH = headerH + visibleRooms.length * rowH + rowH;

    svg.appendChild(svgEl('rect', { x: schedX, y: baseMargin.top, width: schedW, height: totalH, fill: '#f8fafc', stroke: '#0f172a', 'stroke-width': 0.35 }));
    svg.appendChild(svgEl('rect', { x: schedX, y: baseMargin.top, width: schedW, height: headerH, fill: '#e2e8f0', stroke: '#0f172a', 'stroke-width': 0.35 }));
    svg.appendChild(svgEl('text', { x: schedX + 2.5, y: baseMargin.top + 4.7, 'font-size': 3.2, 'font-weight': 700, 'font-family': 'sans-serif', fill: '#0f172a' }, 'ROOM SCHEDULE'));

    let cy = baseMargin.top + headerH;
    visibleRooms.forEach((room) => {
      const labelNote = textNotes.find(
        (n) => Array.isArray(n.pos) && n.text && n.text.trim() && room.polygon && pointInPolygon(n.pos, room.polygon)
      );
      const rawName = labelNote ? labelNote.text.trim() : (room.displayName || room.name || 'Room');
      const name = rawName.length > 16 ? `${rawName.slice(0, 15)}…` : rawName;
      svg.appendChild(svgEl('line', { x1: schedX, y1: cy, x2: schedX + schedW, y2: cy, stroke: '#cbd5e1', 'stroke-width': 0.2 }));
      svg.appendChild(svgEl('text', { x: schedX + 2.5, y: cy + 3.8, 'font-size': 2.8, 'font-family': 'sans-serif', fill: '#1e293b' }, name));
      svg.appendChild(svgEl('text', { x: schedX + schedW - 2.5, y: cy + 3.8, 'text-anchor': 'end', 'font-size': 2.8, 'font-family': 'sans-serif', fill: '#1e293b' }, formatArea(room.area, units)));
      cy += rowH;
    });

    const totalAreaSched = rooms.reduce((sum, r) => sum + (r.area || 0), 0);
    svg.appendChild(svgEl('line', { x1: schedX, y1: cy, x2: schedX + schedW, y2: cy, stroke: '#0f172a', 'stroke-width': 0.3 }));
    svg.appendChild(svgEl('text', { x: schedX + 2.5, y: cy + 3.9, 'font-size': 2.9, 'font-weight': 700, 'font-family': 'sans-serif', fill: '#0f172a' }, `TOTAL (${rooms.length})`));
    svg.appendChild(svgEl('text', { x: schedX + schedW - 2.5, y: cy + 3.9, 'text-anchor': 'end', 'font-size': 2.9, 'font-weight': 700, 'font-family': 'sans-serif', fill: '#0f172a' }, formatArea(totalAreaSched, units)));
  }

  // North Arrow
  if (showNorth) {
    const nx = margin.left + drawWidth - 6;
    const ny = baseMargin.top + 8;
    const r = 6;
    const gNorth = svgEl('g', { transform: `rotate(${northAngle} ${nx} ${ny})` });
    gNorth.appendChild(svgEl('circle', { cx: nx, cy: ny, r, fill: 'none', stroke: '#0f172a', 'stroke-width': 0.3 }));
    gNorth.appendChild(svgEl('polygon', { points: `${nx},${ny - r + 0.6} ${nx - 2.2},${ny + 2.2} ${nx},${ny + 0.8}`, fill: '#0f172a' }));
    gNorth.appendChild(svgEl('polygon', { points: `${nx},${ny - r + 0.6} ${nx + 2.2},${ny + 2.2} ${nx},${ny + 0.8}`, fill: 'none', stroke: '#0f172a', 'stroke-width': 0.25 }));
    gNorth.appendChild(svgEl('text', { x: nx, y: ny - r - 1.6, 'text-anchor': 'middle', 'font-size': 3.5, 'font-weight': 700, 'font-family': 'sans-serif', fill: '#0f172a' }, 'N'));
    svg.appendChild(gNorth);
  }

  // Title Block
  const tbHeight = 20;
  const tbY = paper.height - tbHeight - 5;
  const tbX = baseMargin.left;
  const tbWidth = outerWidth;

  svg.appendChild(svgEl('rect', { x: tbX, y: tbY, width: tbWidth, height: tbHeight, fill: '#f8fafc', stroke: '#0f172a', 'stroke-width': 0.45 }));
  svg.appendChild(svgEl('line', { x1: tbX + tbWidth * 0.5, y1: tbY, x2: tbX + tbWidth * 0.5, y2: tbY + tbHeight, stroke: '#0f172a', 'stroke-width': 0.35 }));
  svg.appendChild(svgEl('line', { x1: tbX + tbWidth * 0.75, y1: tbY, x2: tbX + tbWidth * 0.75, y2: tbY + tbHeight, stroke: '#0f172a', 'stroke-width': 0.35 }));

  svg.appendChild(svgEl('text', {
    x: tbX + 5,
    y: tbY + 7,
    'font-size': 5.6,
    'font-weight': 700,
    'font-family': 'sans-serif',
    fill: '#0f172a',
  }, projectName || 'Floor Plan'));

  const totalArea = rooms.reduce((sum, r) => sum + (r.area || 0), 0);
  const floorSubtitle = rooms.length > 0
    ? `${floor?.name || 'Floor 1'} · ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} · ${formatArea(totalArea, units)}`
    : (floor?.name || 'Floor 1');

  svg.appendChild(svgEl('text', {
    x: tbX + 5,
    y: tbY + 12.5,
    'font-size': 4.0,
    'font-family': 'sans-serif',
    fill: '#475569',
  }, floorSubtitle));

  const clientAddr = [metadata?.client, metadata?.address].filter(Boolean).join(' · ');
  if (clientAddr) {
    svg.appendChild(svgEl('text', {
      x: tbX + 5,
      y: tbY + 17.5,
      'font-size': 3.4,
      'font-family': 'sans-serif',
      fill: '#64748b',
    }, clientAddr));
  }

  svg.appendChild(svgEl('text', {
    x: tbX + tbWidth * 0.5 + 4,
    y: tbY + 7,
    'font-size': 4.2,
    'font-family': 'sans-serif',
    fill: '#0f172a',
  }, `Scale: ${formatScaleLabel(scale, units)}`));

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  svg.appendChild(svgEl('text', {
    x: tbX + tbWidth * 0.5 + 4,
    y: tbY + 12.5,
    'font-size': 3.8,
    'font-family': 'sans-serif',
    fill: '#475569',
  }, dateStr));

  if (metadata?.author) {
    svg.appendChild(svgEl('text', {
      x: tbX + tbWidth * 0.5 + 4,
      y: tbY + 17.5,
      'font-size': 3.4,
      'font-family': 'sans-serif',
      fill: '#64748b',
    }, `Drawn by: ${metadata.author}`));
  }

  svg.appendChild(svgEl('text', {
    x: tbX + tbWidth * 0.75 + 4,
    y: tbY + 7,
    'font-size': 3.6,
    'font-family': 'sans-serif',
    fill: '#64748b',
  }, metadata?.sheetNumber ? `Sheet ${metadata.sheetNumber}` : 'Bay Scallop Extractor'));

  svg.appendChild(svgEl('text', {
    x: tbX + tbWidth * 0.75 + 4,
    y: tbY + 12.5,
    'font-size': 3.6,
    'font-family': 'sans-serif',
    fill: '#64748b',
  }, `${paperSize.toUpperCase()} · Page ${pageIndex + 1} of ${totalPages}`));

  // Exact unit-accurate scale bar above title block
  const scaleBar = computeScaleBar(scale, units, 55);
  const sbY = tbY - 8;
  const scaleBarMm = scaleBar.widthMm;
  const sbX = paper.width - baseMargin.right - Math.max(scaleBarMm, 20);
  const segWidth = scaleBarMm / 4;
  for (let s = 0; s < 4; s++) {
    svg.appendChild(svgEl('rect', {
      x: sbX + s * segWidth,
      y: sbY,
      width: segWidth,
      height: 2,
      fill: s % 2 === 0 ? '#0f172a' : '#ffffff',
      stroke: '#0f172a',
      'stroke-width': 0.3,
    }));
  }
  svg.appendChild(svgEl('text', { x: sbX, y: sbY - 1.5, 'font-size': 3.5, 'font-family': 'sans-serif', fill: '#0f172a' }, '0'));
  svg.appendChild(svgEl('text', {
    x: sbX + scaleBarMm,
    y: sbY - 1.5,
    'text-anchor': 'end',
    'font-size': 3.5,
    'font-family': 'sans-serif',
    fill: '#0f172a',
  }, scaleBar.label));

  container.appendChild(svg);
}
