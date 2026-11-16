/**
 * PDF Exporter — generates architectural blueprint-style PDF floor plans
 * Uses jsPDF for traditional black/white architectural drawing output.
 */
import { jsPDF } from 'jspdf';
import { formatDistance } from './utils/geometry.js';

/** Paper sizes in mm */
export const PAPER_SIZES = {
  a4: { width: 297, height: 210 },      // Landscape A4
  a3: { width: 420, height: 297 },      // Landscape A3
  letter: { width: 279.4, height: 215.9 }, // Landscape Letter
  tabloid: { width: 431.8, height: 279.4 }, // Landscape Tabloid
};

/**
 * Compute layout scale denominator for a floor bounds on a given paper size.
 * Shared between PDF export and live SVG blueprint preview.
 */
export function computeBlueprintScale(bounds, paper, margin, requestedScale = 'auto') {
  const drawWidth = paper.width - margin.left - margin.right;
  const drawHeight = paper.height - margin.top - margin.bottom;
  const dataWidth = Math.max(0.1, bounds.maxX - bounds.minX);
  const dataHeight = Math.max(0.1, bounds.maxY - bounds.minY);

  let scale;
  if (requestedScale === 'auto') {
    const scaleX = drawWidth / (dataWidth * 1000);
    const scaleY = drawHeight / (dataHeight * 1000);
    const fitScale = Math.min(scaleX, scaleY) * 0.85;
    const denom = 1 / fitScale;
    const niceScales = [10, 20, 25, 50, 75, 100, 150, 200, 250, 500];
    scale = niceScales.find((s) => s >= denom) || Math.ceil(denom / 50) * 50;
  } else {
    scale = Number(requestedScale) || 100;
  }

  return { scale, drawWidth, drawHeight, dataWidth, dataHeight };
}

/**
 * Calculate a nice round length for the scale bar
 * @param {number} scale - Scale denominator
 * @returns {number} Length in meters
 */
export function niceScaleBarLength(scale) {
  const targetMm = 50;
  const metersForTarget = (targetMm * scale) / 1000;
  const niceValues = [0.5, 1, 2, 3, 5, 10, 15, 20, 25, 50, 100];
  return niceValues.find((v) => v >= metersForTarget * 0.6) || Math.ceil(metersForTarget);
}

/**
 * Export floor plan data to a professional architectural blueprint PDF
 * @param {Object} options
 * @param {string} options.projectName - Project/file name
 * @param {string} options.paperSize - 'a4' | 'a3' | 'letter' | 'tabloid'
 * @param {number|'auto'} options.scale - Scale denominator (e.g., 50 for 1:50) or 'auto'
 * @param {Array<Object>} options.floors - Array of floor data objects
 * @param {'imperial'|'metric'} [options.units='imperial'] - Unit formatting
 * @param {string} [options.fileName] - Output filename
 * @returns {{ doc: jsPDF, fileName: string }}
 */
export function exportPDF(options) {
  const {
    projectName = 'Floor Plan',
    paperSize = 'a3',
    scale: requestedScale = 'auto',
    floors = [],
    units = 'imperial',
    fileName = 'floorplan.pdf',
  } = options;

  const paper = PAPER_SIZES[paperSize] || PAPER_SIZES.a3;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [paper.width, paper.height],
  });

  const margin = { top: 20, right: 20, bottom: 35, left: 20 };

  for (let i = 0; i < floors.length; i++) {
    if (i > 0) doc.addPage([paper.width, paper.height], 'landscape');

    const floor = floors[i];
    const { walls = [], bounds } = floor;
    if (!bounds) continue;

    const { scale, drawWidth, drawHeight, dataWidth, dataHeight } = computeBlueprintScale(
      bounds,
      paper,
      margin,
      requestedScale
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

    // === Draw border ===
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(margin.left - 5, margin.top - 5, drawWidth + 10, drawHeight + 10);

    // === Draw walls ===
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.6);

    for (const seg of walls) {
      const p1 = toPage(seg[0][0], seg[0][1]);
      const p2 = toPage(seg[1][0], seg[1][1]);
      doc.line(p1.x, p1.y, p2.x, p2.y);
    }

    // === Overall dimension lines ===
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.15);
    doc.setFontSize(5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);

    const dimOffset = 0.3;
    const tickH = 1;

    // Bottom dimension (total width)
    const wP1 = toPage(bounds.minX, bounds.maxY + dimOffset);
    const wP2 = toPage(bounds.maxX, bounds.maxY + dimOffset);
    doc.line(wP1.x, wP1.y, wP2.x, wP2.y);
    doc.line(wP1.x, wP1.y - tickH, wP1.x, wP1.y + tickH);
    doc.line(wP2.x, wP2.y - tickH, wP2.x, wP2.y + tickH);
    const wMid = toPage((bounds.minX + bounds.maxX) / 2, bounds.maxY + dimOffset);
    doc.text(formatDistance(dataWidth, units), wMid.x, wMid.y + 3, { align: 'center' });

    // Right dimension (total height)
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
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);

      for (const note of floor.textNotes) {
        const pt = toPage(note.pos[0], note.pos[1]);
        doc.text(note.text, pt.x, pt.y, { align: 'center' });
      }
    }

    // === Title Block ===
    const tbHeight = 20;
    const tbY = paper.height - tbHeight - 5;
    const tbX = margin.left;
    const tbWidth = paper.width - margin.left - margin.right;

    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
    doc.rect(tbX, tbY, tbWidth, tbHeight);

    doc.line(tbX + tbWidth * 0.5, tbY, tbX + tbWidth * 0.5, tbY + tbHeight);
    doc.line(tbX + tbWidth * 0.75, tbY, tbX + tbWidth * 0.75, tbY + tbHeight);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(projectName, tbX + 5, tbY + 8);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(floor.name || `Floor ${i + 1}`, tbX + 5, tbY + 14);

    doc.setFontSize(9);
    doc.text(`Scale: 1:${scale}`, tbX + tbWidth * 0.5 + 5, tbY + 8);

    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc.setFontSize(8);
    doc.text(dateStr, tbX + tbWidth * 0.5 + 5, tbY + 14);

    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text('Generated by Bay Scallop · FloorPlan Extractor', tbX + tbWidth * 0.75 + 5, tbY + 8);
    doc.text(`Page ${i + 1} of ${floors.length}`, tbX + tbWidth * 0.75 + 5, tbY + 14);

    // === Scale Bar ===
    const sbY = tbY - 8;
    const sbX = paper.width - margin.right - 60;
    const scaleBarMeters = niceScaleBarLength(scale);
    const scaleBarMm = scaleBarMeters * mmPerMeter;

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

    const scaleLabel = units === 'metric'
      ? `${scaleBarMeters} m`
      : `${Math.round(scaleBarMeters * 3.28084)} ft`;
    doc.setFontSize(6);
    doc.setTextColor(0, 0, 0);
    doc.text('0', sbX, sbY - 1);
    doc.text(scaleLabel, sbX + scaleBarMm, sbY - 1, { align: 'right' });
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
