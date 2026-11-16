/**
 * Live Blueprint SVG Preview (Step 4)
 * Renders an accurate vector preview matching PDF export output, or a helpful empty state.
 */
import { PAPER_SIZES, computeBlueprintScale, niceScaleBarLength } from '../pdf-exporter.js';
import { formatDistance } from '../utils/geometry.js';
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
    scale: requestedScale = 'auto',
    units = 'imperial',
    onLoadSample,
    onGoToEditor,
  } = opts;

  const walls = floor?.walls || floor?.segments || [];
  const measurements = floor?.measurements || [];
  const textNotes = floor?.textNotes || [];
  const bounds = floor?.bounds;

  const hasContent = Boolean(bounds && (walls.length > 0 || measurements.length > 0 || textNotes.length > 0));

  if (!hasContent) {
    container.classList.add('is-empty');
    container.style.aspectRatio = '1.414';
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

  const paper = PAPER_SIZES[paperSize] || PAPER_SIZES.a3;
  container.style.aspectRatio = `${paper.width} / ${paper.height}`;

  const margin = { top: 20, right: 20, bottom: 35, left: 20 };
  const { scale, drawWidth, drawHeight, dataWidth, dataHeight } = computeBlueprintScale(
    bounds,
    paper,
    margin,
    requestedScale === 'auto' ? 'auto' : Number(requestedScale)
  );

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
    x: margin.left - 5,
    y: margin.top - 5,
    width: drawWidth + 10,
    height: drawHeight + 10,
    fill: 'none',
    stroke: '#0f172a',
    'stroke-width': 0.5,
  }));

  const drawingGroup = svgEl('g', { 'clip-path': 'url(#blueprint-draw-clip)' });

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

  // Title Block
  const tbHeight = 20;
  const tbY = paper.height - tbHeight - 5;
  const tbX = margin.left;
  const tbWidth = paper.width - margin.left - margin.right;

  svg.appendChild(svgEl('rect', { x: tbX, y: tbY, width: tbWidth, height: tbHeight, fill: '#f8fafc', stroke: '#0f172a', 'stroke-width': 0.45 }));
  svg.appendChild(svgEl('line', { x1: tbX + tbWidth * 0.5, y1: tbY, x2: tbX + tbWidth * 0.5, y2: tbY + tbHeight, stroke: '#0f172a', 'stroke-width': 0.35 }));
  svg.appendChild(svgEl('line', { x1: tbX + tbWidth * 0.75, y1: tbY, x2: tbX + tbWidth * 0.75, y2: tbY + tbHeight, stroke: '#0f172a', 'stroke-width': 0.35 }));

  svg.appendChild(svgEl('text', {
    x: tbX + 5,
    y: tbY + 8,
    'font-size': 5.8,
    'font-weight': 700,
    'font-family': 'sans-serif',
    fill: '#0f172a',
  }, projectName || 'Floor Plan'));

  svg.appendChild(svgEl('text', {
    x: tbX + 5,
    y: tbY + 14.5,
    'font-size': 4.2,
    'font-family': 'sans-serif',
    fill: '#475569',
  }, floor?.name || 'Floor 1'));

  svg.appendChild(svgEl('text', {
    x: tbX + tbWidth * 0.5 + 5,
    y: tbY + 8,
    'font-size': 4.6,
    'font-family': 'sans-serif',
    fill: '#0f172a',
  }, `Scale: 1:${scale}`));

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  svg.appendChild(svgEl('text', {
    x: tbX + tbWidth * 0.5 + 5,
    y: tbY + 14.5,
    'font-size': 4.0,
    'font-family': 'sans-serif',
    fill: '#475569',
  }, dateStr));

  svg.appendChild(svgEl('text', {
    x: tbX + tbWidth * 0.75 + 5,
    y: tbY + 8,
    'font-size': 3.6,
    'font-family': 'sans-serif',
    fill: '#64748b',
  }, 'Bay Scallop Extractor'));

  svg.appendChild(svgEl('text', {
    x: tbX + tbWidth * 0.75 + 5,
    y: tbY + 14.5,
    'font-size': 3.6,
    'font-family': 'sans-serif',
    fill: '#64748b',
  }, `${paperSize.toUpperCase()} · Page 1 of 1`));

  // Scale bar above title block
  const sbY = tbY - 8;
  const sbX = paper.width - margin.right - 60;
  const scaleBarMeters = niceScaleBarLength(scale);
  const scaleBarMm = Math.min(55, scaleBarMeters * mmPerMeter);
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
  const scaleLabel = units === 'metric'
    ? `${scaleBarMeters} m`
    : `${Math.round(scaleBarMeters * 3.28084)} ft`;
  svg.appendChild(svgEl('text', { x: sbX, y: sbY - 1.5, 'font-size': 3.5, 'font-family': 'sans-serif', fill: '#0f172a' }, '0'));
  svg.appendChild(svgEl('text', {
    x: sbX + scaleBarMm,
    y: sbY - 1.5,
    'text-anchor': 'end',
    'font-size': 3.5,
    'font-family': 'sans-serif',
    fill: '#0f172a',
  }, scaleLabel));

  container.appendChild(svg);
}
