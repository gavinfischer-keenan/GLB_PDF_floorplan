/**
 * PDF Exporter — generates architectural blueprint-style PDF floor plans
 * Uses jsPDF for traditional black/white architectural drawing output.
 */
import { jsPDF } from 'jspdf';
import { formatDistance, formatArea, pointInPolygon } from './utils/geometry.js';
import {
  PAPER_SIZES,
  getPaperDimensions,
  formatScaleLabel,
  computeBlueprintScale,
  niceScaleBarLength,
  computeScaleBar,
} from './utils/blueprint-layout.js';

export {
  PAPER_SIZES,
  getPaperDimensions,
  formatScaleLabel,
  computeBlueprintScale,
  niceScaleBarLength,
  computeScaleBar,
};

/**
 * Draw an architectural door, window, archway, or stairs symbol onto jsPDF.
 */
function drawPDFSymbol(doc, sym, toPage, mmPerMeter) {
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

    const c1 = pt(-hl, -hw);
    const c2 = pt(hl, -hw);
    const c3 = pt(hl, hw);
    const c4 = pt(-hl, hw);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.35);
    doc.moveTo(c1.x, c1.y);
    doc.lineTo(c2.x, c2.y);
    doc.lineTo(c3.x, c3.y);
    doc.lineTo(c4.x, c4.y);
    doc.close();
    doc.fillStroke();

    const numTreads = Math.max(4, Math.min(18, Math.round(length / 0.28)));
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.2);
    for (let t = 1; t < numTreads; t++) {
      const f = -hl + (t / numTreads) * length;
      const t1 = pt(f, -hw);
      const t2 = pt(f, hw);
      doc.line(t1.x, t1.y, t2.x, t2.y);
    }

    const a0 = pt(-swing * hl * 0.72, 0);
    const a1 = pt(swing * hl * 0.72, 0);
    const headLen = Math.min(0.24, width * 0.28);
    const h1 = pt(swing * hl * 0.72 - swing * headLen, headLen * 0.7);
    const h2 = pt(swing * hl * 0.72 - swing * headLen, -headLen * 0.7);

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.35);
    doc.line(a0.x, a0.y, a1.x, a1.y);
    doc.line(a1.x, a1.y, h1.x, h1.y);
    doc.line(a1.x, a1.y, h2.x, h2.y);

    const lblPt = pt(-swing * hl * 0.22, 0);
    doc.setFontSize(5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('UP', lblPt.x, lblPt.y + 0.8, { align: 'center' });
    return;
  }

  const width = sym.width || (sym.kind === 'door' ? 0.9 : 1.2);
  const half = width * 0.5;
  const nx = -uy * swing;
  const ny = ux * swing;

  const pStart = toPage(sym.pos[0] - ux * half, sym.pos[1] - uy * half);
  const pEnd = toPage(sym.pos[0] + ux * half, sym.pos[1] + uy * half);

  // Break the underlying wall with white gap
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(1.1);
  doc.line(pStart.x, pStart.y, pEnd.x, pEnd.y);

  if (sym.kind === 'archway') {
    const jamb = Math.max(0.8, 0.09 * mmPerMeter);
    const jx = -uy * jamb;
    const jy = ux * jamb;
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.35);
    doc.line(pStart.x - jx, pStart.y - jy, pStart.x + jx, pStart.y + jy);
    doc.line(pEnd.x - jx, pEnd.y - jy, pEnd.x + jx, pEnd.y + jy);
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1.2, 1.0], 0);
    doc.line(pStart.x, pStart.y, pEnd.x, pEnd.y);
    doc.setLineDashPattern([], 0);
    return;
  }

  if (sym.kind === 'window') {
    const thick = Math.max(0.6, 0.08 * mmPerMeter);
    const px = -uy * (thick * 0.5);
    const py = ux * (thick * 0.5);

    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.25);
    doc.line(pStart.x - px, pStart.y - py, pEnd.x - px, pEnd.y - py);
    doc.line(pStart.x + px, pStart.y + py, pEnd.x + px, pEnd.y + py);
    doc.line(pStart.x - px, pStart.y - py, pStart.x + px, pStart.y + py);
    doc.line(pEnd.x - px, pEnd.y - py, pEnd.x + px, pEnd.y + py);
    doc.setDrawColor(59, 130, 246);
    doc.setLineWidth(0.2);
    doc.line(pStart.x, pStart.y, pEnd.x, pEnd.y);
    return;
  }

  // Door: leaf from hinge (pStart) perpendicular by width, plus 90-deg swing arc
  const tipWorld = [
    sym.pos[0] - ux * half + nx * width,
    sym.pos[1] - uy * half + ny * width,
  ];
  const pTip = toPage(tipWorld[0], tipWorld[1]);

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.45);
  doc.line(pStart.x, pStart.y, pTip.x, pTip.y);

  // Quarter-circle arc polyline
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.2);
  const steps = 12;
  const hingeWorldX = sym.pos[0] - ux * half;
  const hingeWorldY = sym.pos[1] - uy * half;
  let prevPt = pTip;
  for (let s = 1; s <= steps; s++) {
    const t = (s / steps) * (Math.PI / 2);
    const wx = hingeWorldX + (nx * Math.cos(t) + ux * Math.sin(t)) * width;
    const wy = hingeWorldY + (ny * Math.cos(t) + uy * Math.sin(t)) * width;
    const pt = toPage(wx, wy);
    doc.line(prevPt.x, prevPt.y, pt.x, pt.y);
    prevPt = pt;
  }
}

/**
 * Draw a North Arrow compass on jsPDF at (cx, cy), rotated northAngle degrees clockwise.
 */
function drawPDFNorthArrow(doc, cx, cy, northAngle = 0) {
  const r = 6;
  const rad = (northAngle * Math.PI) / 180;
  const rot = (lx, ly) => ({
    x: cx + lx * Math.cos(rad) - ly * Math.sin(rad),
    y: cy + lx * Math.sin(rad) + ly * Math.cos(rad),
  });

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.3);
  doc.circle(cx, cy, r, 'S');

  const tip = rot(0, -r + 0.6);
  const left = rot(-2.2, 2.2);
  const base = rot(0, 0.8);
  const right = rot(2.2, 2.2);

  doc.setFillColor(15, 23, 42);
  doc.moveTo(tip.x, tip.y);
  doc.lineTo(left.x, left.y);
  doc.lineTo(base.x, base.y);
  doc.close();
  doc.fill();

  doc.setDrawColor(15, 23, 42);
  doc.line(tip.x, tip.y, right.x, right.y);
  doc.line(right.x, right.y, base.x, base.y);

  const labelPt = rot(0, -r - 1.8);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('N', labelPt.x, labelPt.y, { align: 'center' });
}

/**
 * Draw a Room Schedule table column on the right side of the sheet.
 */
function drawPDFRoomSchedule(doc, rooms, textNotes, x, y, width, maxHeight, units) {
  const rowH = 5.5;
  const headerH = 7;
  const maxRows = Math.max(1, Math.floor((maxHeight - headerH - rowH - 2) / rowH));
  const visibleRooms = rooms.slice(0, maxRows);
  const totalH = headerH + visibleRooms.length * rowH + rowH;

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.35);
  doc.setFillColor(248, 250, 252);
  doc.rect(x, y, width, totalH, 'FD');

  doc.setFillColor(226, 232, 240);
  doc.rect(x, y, width, headerH, 'FD');

  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('ROOM SCHEDULE', x + 2.5, y + 4.7);

  let cy = y + headerH;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);

  visibleRooms.forEach((room) => {
    const labelNote = textNotes.find(
      (n) => Array.isArray(n.pos) && n.text && n.text.trim() && room.polygon && pointInPolygon(n.pos, room.polygon)
    );
    const rawName = labelNote ? labelNote.text.trim() : (room.displayName || room.name || 'Room');
    const name = rawName.length > 16 ? `${rawName.slice(0, 15)}…` : rawName;
    const areaStr = formatArea(room.area, units);

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.15);
    doc.line(x, cy, x + width, cy);

    doc.setTextColor(30, 41, 59);
    doc.text(name, x + 2.5, cy + 3.8);
    doc.text(areaStr, x + width - 2.5, cy + 3.8, { align: 'right' });
    cy += rowH;
  });

  const totalArea = rooms.reduce((sum, r) => sum + (r.area || 0), 0);
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.25);
  doc.line(x, cy, x + width, cy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(15, 23, 42);
  doc.text(`TOTAL (${rooms.length})`, x + 2.5, cy + 3.9);
  doc.text(formatArea(totalArea, units), x + width - 2.5, cy + 3.9, { align: 'right' });
}

/**
 * Export floor plan data to a professional architectural blueprint PDF
 * @param {Object} options
 * @param {string} options.projectName - Project/file name
 * @param {string} options.paperSize - 'a4' | 'a3' | 'letter' | 'tabloid'
 * @param {'landscape'|'portrait'} [options.orientation='landscape']
 * @param {number|'auto'} options.scale - Scale denominator (e.g., 48, 50, 100) or 'auto'
 * @param {Array<Object>} options.floors - Array of floor data objects
 * @param {'imperial'|'metric'} [options.units='imperial'] - Unit formatting
 * @param {boolean} [options.showRooms=true] - Render room fills & labels
 * @param {boolean} [options.showNorth=true] - Render North arrow
 * @param {number} [options.northAngle=0] - North arrow angle in degrees
 * @param {boolean} [options.includeRoomSchedule=false] - Draw Room Schedule table on sheet
 * @param {Object} [options.metadata] - Optional { client, address, author, sheetNumber }
 * @param {string} [options.fileName] - Output filename
 * @returns {{ doc: jsPDF, fileName: string }}
 */
export function exportPDF(options) {
  const {
    projectName = 'Floor Plan',
    paperSize = 'a3',
    orientation = 'landscape',
    scale: requestedScale = 'auto',
    floors = [],
    units = 'imperial',
    showRooms = true,
    showNorth = true,
    northAngle = 0,
    includeRoomSchedule = false,
    metadata = {},
    fileName = 'floorplan.pdf',
  } = options;

  const paper = getPaperDimensions(paperSize, orientation);

  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: [paper.width, paper.height],
  });

  const baseMargin = { top: 20, right: 20, bottom: 35, left: 20 };

  for (let i = 0; i < floors.length; i++) {
    if (i > 0) doc.addPage([paper.width, paper.height], orientation);

    const floor = floors[i];
    const { walls = [], bounds, rooms = [], symbols = [] } = floor;
    if (!bounds) continue;

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
      requestedScale,
      units
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

    const outerWidth = paper.width - baseMargin.left - baseMargin.right;
    const outerHeight = paper.height - baseMargin.top - baseMargin.bottom;

    // === Draw outer border ===
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(baseMargin.left - 5, baseMargin.top - 5, outerWidth + 10, outerHeight + 10);

    // === Room fills ===
    if (showRooms && rooms.length > 0) {
      const fills = [
        [241, 245, 249],
        [236, 253, 245],
        [245, 243, 255],
        [255, 251, 235],
      ];
      for (let rIdx = 0; rIdx < rooms.length; rIdx++) {
        const room = rooms[rIdx];
        if (!room.polygon || room.polygon.length < 3) continue;
        const c = fills[rIdx % fills.length];
        doc.setFillColor(c[0], c[1], c[2]);
        const p0 = toPage(room.polygon[0][0], room.polygon[0][1]);
        doc.moveTo(p0.x, p0.y);
        for (let k = 1; k < room.polygon.length; k++) {
          const pk = toPage(room.polygon[k][0], room.polygon[k][1]);
          doc.lineTo(pk.x, pk.y);
        }
        doc.close();
        doc.fill();
      }
    }

    // === Draw walls ===
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.6);

    for (const seg of walls) {
      const p1 = toPage(seg[0][0], seg[0][1]);
      const p2 = toPage(seg[1][0], seg[1][1]);
      doc.line(p1.x, p1.y, p2.x, p2.y);
    }

    // === Draw doors & windows ===
    for (const sym of symbols) {
      drawPDFSymbol(doc, sym, toPage, mmPerMeter);
    }

    // === Room labels & areas ===
    if (showRooms && rooms.length > 0) {
      const textNotes = floor.textNotes || [];
      for (const room of rooms) {
        if (!room.centroid) continue;
        const center = toPage(room.centroid[0], room.centroid[1]);
        const hasManualNote = textNotes.some(
          (n) => Array.isArray(n.pos) && n.text && n.text.trim() && room.polygon && pointInPolygon(n.pos, room.polygon)
        );
        if (!hasManualNote) {
          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(30, 41, 59);
          doc.text(room.displayName || room.name || 'Room', center.x, center.y - 1.2, { align: 'center' });
        }
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(formatArea(room.area, units), center.x, hasManualNote ? center.y + 4.0 : center.y + 2.4, { align: 'center' });
      }
    }

    // === Overall dimension lines ===
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.15);
    doc.setFontSize(5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);

    const dimOffset = 0.3;
    const tickH = 1;

    const wP1 = toPage(bounds.minX, bounds.maxY + dimOffset);
    const wP2 = toPage(bounds.maxX, bounds.maxY + dimOffset);
    doc.line(wP1.x, wP1.y, wP2.x, wP2.y);
    doc.line(wP1.x, wP1.y - tickH, wP1.x, wP1.y + tickH);
    doc.line(wP2.x, wP2.y - tickH, wP2.x, wP2.y + tickH);
    const wMid = toPage((bounds.minX + bounds.maxX) / 2, bounds.maxY + dimOffset);
    doc.text(formatDistance(dataWidth, units), wMid.x, wMid.y + 3, { align: 'center' });

    const hP1 = toPage(bounds.maxX + dimOffset, bounds.minY);
    const hP2 = toPage(bounds.maxX + dimOffset, bounds.maxY);
    doc.line(hP1.x, hP1.y, hP2.x, hP2.y);
    doc.line(hP1.x - tickH, hP1.y, hP1.x + tickH, hP1.y);
    doc.line(hP2.x - tickH, hP2.y, hP2.x + tickH, hP2.y);
    const hMid = toPage(bounds.maxX + dimOffset, (bounds.minY + bounds.maxY) / 2);
    doc.text(formatDistance(dataHeight, units), hMid.x + 3, hMid.y, { align: 'center', angle: 90 });

    // === Custom user measurements ===
    if (floor.measurements && floor.measurements.length > 0) {
      doc.setDrawColor(80, 80, 80);
      doc.setLineWidth(0.15);
      doc.setFontSize(6);
      doc.setTextColor(60, 60, 60);

      for (const m of floor.measurements) {
        const mP1 = toPage(m.p1[0], m.p1[1]);
        const mP2 = toPage(m.p2[0], m.p2[1]);
        doc.line(mP1.x, mP1.y, mP2.x, mP2.y);
        doc.line(mP1.x - tickH, mP1.y - tickH, mP1.x + tickH, mP1.y + tickH);
        doc.line(mP2.x - tickH, mP2.y - tickH, mP2.x + tickH, mP2.y + tickH);
        const mMid = toPage((m.p1[0] + m.p2[0]) / 2, (m.p1[1] + m.p2[1]) / 2);
        doc.text(m.text, mMid.x, mMid.y - 1.5, { align: 'center' });
      }
    }

    // === Custom user text notes ===
    if (floor.textNotes && floor.textNotes.length > 0) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);

      for (const note of floor.textNotes) {
        const pt = toPage(note.pos[0], note.pos[1]);
        doc.text(note.text, pt.x, pt.y, { align: 'center' });
      }
    }

    // === Room Schedule Table ===
    if (hasSchedule) {
      const schedX = paper.width - baseMargin.right - scheduleWidth + 2;
      drawPDFRoomSchedule(doc, rooms, floor.textNotes || [], schedX, baseMargin.top, scheduleWidth - 2, outerHeight - 10, units);
    }

    // === North Arrow ===
    if (showNorth) {
      const northX = margin.left + drawWidth - 6;
      const northY = baseMargin.top + 8;
      drawPDFNorthArrow(doc, northX, northY, northAngle);
    }

    // === Title Block ===
    const tbHeight = 20;
    const tbY = paper.height - tbHeight - 5;
    const tbX = baseMargin.left;
    const tbWidth = outerWidth;

    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
    doc.rect(tbX, tbY, tbWidth, tbHeight);

    doc.line(tbX + tbWidth * 0.5, tbY, tbX + tbWidth * 0.5, tbY + tbHeight);
    doc.line(tbX + tbWidth * 0.75, tbY, tbX + tbWidth * 0.75, tbY + tbHeight);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(projectName, tbX + 5, tbY + 7);

    const totalArea = rooms.reduce((sum, r) => sum + (r.area || 0), 0);
    const floorSubtitle = rooms.length > 0
      ? `${floor.name || `Floor ${i + 1}`} · ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} · ${formatArea(totalArea, units)}`
      : (floor.name || `Floor ${i + 1}`);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(floorSubtitle, tbX + 5, tbY + 12.5);

    const clientAddr = [metadata?.client, metadata?.address].filter(Boolean).join(' · ');
    if (clientAddr) {
      doc.setFontSize(7);
      doc.setTextColor(90, 90, 90);
      doc.text(clientAddr, tbX + 5, tbY + 17.5);
    }

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(8.5);
    doc.text(`Scale: ${formatScaleLabel(scale, units)}`, tbX + tbWidth * 0.5 + 4, tbY + 7);

    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc.setFontSize(7.5);
    doc.text(dateStr, tbX + tbWidth * 0.5 + 4, tbY + 12.5);

    if (metadata?.author) {
      doc.setFontSize(7);
      doc.setTextColor(90, 90, 90);
      doc.text(`Drawn by: ${metadata.author}`, tbX + tbWidth * 0.5 + 4, tbY + 17.5);
    }

    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    const rightHeader = metadata?.sheetNumber
      ? `Sheet ${metadata.sheetNumber}`
      : 'Bay Scallop · FloorPlan Extractor';
    doc.text(rightHeader, tbX + tbWidth * 0.75 + 4, tbY + 7);
    doc.text(`Page ${i + 1} of ${floors.length}`, tbX + tbWidth * 0.75 + 4, tbY + 12.5);
    if (metadata?.sheetNumber) {
      doc.text('Bay Scallop Extractor', tbX + tbWidth * 0.75 + 4, tbY + 17.5);
    }

    // === Exact Unit-Accurate Scale Bar ===
    const scaleBar = computeScaleBar(scale, units, 55);
    const sbY = tbY - 8;
    const scaleBarMm = scaleBar.widthMm;
    const sbX = paper.width - baseMargin.right - Math.max(scaleBarMm, 20);

    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.setFillColor(0, 0, 0);

    const segments = 4;
    const segWidth = scaleBarMm / segments;
    for (let s = 0; s < segments; s++) {
      if (s % 2 === 0) {
        doc.rect(sbX + s * segWidth, sbY, segWidth, 2, 'F');
      } else {
        doc.rect(sbX + s * segWidth, sbY, segWidth, 2);
      }
    }

    doc.setFontSize(6);
    doc.setTextColor(0, 0, 0);
    doc.text('0', sbX, sbY - 1);
    doc.text(scaleBar.label, sbX + scaleBarMm, sbY - 1, { align: 'right' });
  }

  return { doc, fileName };
}

/**
 * Trigger PDF download or save via File System Access API
 * @param {jsPDF} doc - The PDF document
 * @param {string} fileName - Suggested file name
 */
export async function savePDF(doc, fileName) {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'PDF Document',
            accept: { 'application/pdf': ['.pdf'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      const pdfBlob = doc.output('blob');
      await writable.write(pdfBlob);
      await writable.close();
      return { success: true, method: 'filesystem' };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: false, cancelled: true };
      }
    }
  }

  doc.save(fileName);
  return { success: true, method: 'download' };
}
