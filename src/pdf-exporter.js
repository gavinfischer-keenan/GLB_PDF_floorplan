/**
 * PDF Exporter — generates architectural blueprint-style PDF floor plans
 * Uses jsPDF for traditional black/white architectural drawing output.
 */
import { jsPDF } from 'jspdf';

/** Paper sizes in mm */
const PAPER_SIZES = {
  a4: { width: 297, height: 210 },      // Landscape A4
  a3: { width: 420, height: 297 },      // Landscape A3
  letter: { width: 279.4, height: 215.9 }, // Landscape Letter
  tabloid: { width: 431.8, height: 279.4 }, // Landscape Tabloid
};

/**
 * Export floor plan data to a professional architectural blueprint PDF
 * @param {Object} options
 * @param {string} options.projectName - Project/file name
 * @param {string} options.paperSize - 'a4' | 'a3' | 'letter' | 'tabloid'
 * @param {number|'auto'} options.scale - Scale denominator (e.g., 50 for 1:50) or 'auto'
 * @param {Array<Object>} options.floors - Array of floor data objects
 * @param {string} [options.fileName] - Output filename
 * @returns {jsPDF} The generated PDF document
 */
export function exportPDF(options) {
  const {
    projectName = 'Floor Plan',
    paperSize = 'a3',
    scale: requestedScale = 'auto',
    floors = [],
    fileName = 'floorplan.pdf',
  } = options;

  const paper = PAPER_SIZES[paperSize] || PAPER_SIZES.a3;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [paper.width, paper.height],
  });

  // Margins
  const margin = { top: 20, right: 20, bottom: 35, left: 20 };
  const drawWidth = paper.width - margin.left - margin.right;
  const drawHeight = paper.height - margin.top - margin.bottom;

  for (let i = 0; i < floors.length; i++) {
    if (i > 0) doc.addPage([paper.width, paper.height], 'landscape');

    const floor = floors[i];
    const { walls, rooms, bounds } = floor;

    if (!bounds) continue;

    // Calculate scale
    const dataWidth = bounds.maxX - bounds.minX;
    const dataHeight = bounds.maxY - bounds.minY;

    let scale;
    if (requestedScale === 'auto') {
      // Auto-fit: find scale that fits content in the drawing area
      const scaleX = drawWidth / (dataWidth * 1000); // data is in meters, convert to mm
      const scaleY = drawHeight / (dataHeight * 1000);
      const fitScale = Math.min(scaleX, scaleY) * 0.85; // 85% of available space
      // Round to a nice scale
      const denom = 1 / fitScale;
      const niceScales = [10, 20, 25, 50, 75, 100, 150, 200, 250, 500];
      scale = niceScales.find((s) => s >= denom) || Math.ceil(denom / 50) * 50;
    } else {
      scale = requestedScale;
    }

    const mmPerMeter = 1000 / scale; // mm on paper per meter in reality

    // Center the drawing
    const drawingWidth = dataWidth * mmPerMeter;
    const drawingHeight = dataHeight * mmPerMeter;
    const offsetX = margin.left + (drawWidth - drawingWidth) / 2;
    const offsetY = margin.top + (drawHeight - drawingHeight) / 2;

    /**
     * Convert model coordinates (meters) to page coordinates (mm)
     */
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
    doc.setLineWidth(0.6); // Thick lines for walls

    for (const seg of walls) {
      const p1 = toPage(seg[0][0], seg[0][1]);
      const p2 = toPage(seg[1][0], seg[1][1]);
      doc.line(p1.x, p1.y, p2.x, p2.y);
    }

    // === Draw room fills (very light gray) ===
    doc.setFillColor(245, 245, 245);
    for (const room of rooms) {
      if (!room.polygon || room.polygon.length < 3) continue;
      const points = room.polygon.map((p) => {
        const pp = toPage(p[0], p[1]);
        return [pp.x, pp.y];
      });
      // Draw filled polygon
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.15);

      // jsPDF polygon drawing
      const startPoint = points[0];
      doc.moveTo(startPoint[0], startPoint[1]);
      for (let j = 1; j < points.length; j++) {
        doc.lineTo(points[j][0], points[j][1]);
      }
      doc.lineTo(startPoint[0], startPoint[1]);
      doc.fill();
    }

    // Re-draw walls on top of room fills
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.6);
    for (const seg of walls) {
      const p1 = toPage(seg[0][0], seg[0][1]);
      const p2 = toPage(seg[1][0], seg[1][1]);
      doc.line(p1.x, p1.y, p2.x, p2.y);
    }

    // === Room labels ===
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');

    for (const room of rooms) {
      if (!room.centroid) continue;
      const center = toPage(room.centroid[0], room.centroid[1]);

      // Room name
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      const name = room.name || 'Room';
      doc.text(name, center.x, center.y - 2, { align: 'center' });

      // Room area
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      const areaText = `${Math.abs(room.area).toFixed(1)} m²`;
      doc.text(areaText, center.x, center.y + 2, { align: 'center' });
    }

    // === Dimension lines for each room ===
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.15);
    doc.setFontSize(5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);

    for (const room of rooms) {
      if (!room.polygon || room.polygon.length < 3) continue;

      // Compute room bounding box
      let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
      for (const p of room.polygon) {
        rMinX = Math.min(rMinX, p[0]);
        rMinY = Math.min(rMinY, p[1]);
        rMaxX = Math.max(rMaxX, p[0]);
        rMaxY = Math.max(rMaxY, p[1]);
      }

      const w = rMaxX - rMinX;
      const h = rMaxY - rMinY;

      // Only show dimensions for rooms > 3m²
      if (Math.abs(room.area) < 3) continue;

      const dimOffset = 0.15; // meters offset from room edge

      // Width dimension (bottom)
      const wP1 = toPage(rMinX, rMaxY + dimOffset);
      const wP2 = toPage(rMaxX, rMaxY + dimOffset);
      doc.line(wP1.x, wP1.y, wP2.x, wP2.y);
      // Tick marks
      const tickH = 1; // mm
      doc.line(wP1.x, wP1.y - tickH, wP1.x, wP1.y + tickH);
      doc.line(wP2.x, wP2.y - tickH, wP2.x, wP2.y + tickH);
      // Text
      const wMid = toPage((rMinX + rMaxX) / 2, rMaxY + dimOffset);
      doc.text(`${w.toFixed(2)}m`, wMid.x, wMid.y + 3, { align: 'center' });

      // Height dimension (right)
      const hP1 = toPage(rMaxX + dimOffset, rMinY);
      const hP2 = toPage(rMaxX + dimOffset, rMaxY);
      doc.line(hP1.x, hP1.y, hP2.x, hP2.y);
      doc.line(hP1.x - tickH, hP1.y, hP1.x + tickH, hP1.y);
      doc.line(hP2.x - tickH, hP2.y, hP2.x + tickH, hP2.y);
      const hMid = toPage(rMaxX + dimOffset, (rMinY + rMaxY) / 2);
      doc.text(`${h.toFixed(2)}m`, hMid.x + 3, hMid.y, { align: 'center', angle: 90 });
    }

    // === Title Block ===
    const tbHeight = 20;
    const tbY = paper.height - tbHeight - 5;
    const tbX = margin.left;
    const tbWidth = paper.width - margin.left - margin.right;

    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
    doc.rect(tbX, tbY, tbWidth, tbHeight);

    // Dividers
    doc.line(tbX + tbWidth * 0.5, tbY, tbX + tbWidth * 0.5, tbY + tbHeight);
    doc.line(tbX + tbWidth * 0.75, tbY, tbX + tbWidth * 0.75, tbY + tbHeight);

    // Project name
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(projectName, tbX + 5, tbY + 8);

    // Floor name
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(floor.name || `Floor ${i + 1}`, tbX + 5, tbY + 14);

    // Scale
    doc.setFontSize(9);
    doc.text(`Scale: 1:${scale}`, tbX + tbWidth * 0.5 + 5, tbY + 8);

    // Date
    const dateStr = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc.setFontSize(8);
    doc.text(dateStr, tbX + tbWidth * 0.5 + 5, tbY + 14);

    // Generated by
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text('Generated by FloorPlan Extractor', tbX + tbWidth * 0.75 + 5, tbY + 8);
    doc.text(`Page ${i + 1} of ${floors.length}`, tbX + tbWidth * 0.75 + 5, tbY + 14);

    // === Scale Bar ===
    const sbY = tbY - 8;
    const sbX = paper.width - margin.right - 60;
    const scaleBarMeters = _niceScaleBarLength(scale);
    const scaleBarMm = scaleBarMeters * mmPerMeter;

    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.setFillColor(0, 0, 0);

    // Alternating black/white bar
    const segments = 4;
    const segWidth = scaleBarMm / segments;
    for (let s = 0; s < segments; s++) {
      if (s % 2 === 0) {
        doc.rect(sbX + s * segWidth, sbY, segWidth, 2, 'F');
      } else {
        doc.rect(sbX + s * segWidth, sbY, segWidth, 2);
      }
    }

    // Labels
    doc.setFontSize(6);
    doc.setTextColor(0, 0, 0);
    doc.text('0', sbX, sbY - 1);
    doc.text(`${scaleBarMeters}m`, sbX + scaleBarMm, sbY - 1, { align: 'right' });
  }

  return { doc, fileName };
}

/**
 * Calculate a nice round length for the scale bar
 * @param {number} scale - Scale denominator
 * @returns {number} Length in meters
 */
function _niceScaleBarLength(scale) {
  // We want the scale bar to be roughly 40-60mm on paper
  const targetMm = 50;
  const metersForTarget = (targetMm * scale) / 1000;

  // Round to a nice number
  const niceValues = [0.5, 1, 2, 3, 5, 10, 15, 20, 25, 50, 100];
  return niceValues.find((v) => v >= metersForTarget * 0.6) || Math.ceil(metersForTarget);
}

/**
 * Trigger PDF download or save via File System Access API
 * @param {jsPDF} doc - The PDF document
 * @param {string} fileName - Suggested file name
 */
export async function savePDF(doc, fileName) {
  // Try File System Access API first (Chrome/Edge)
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
      // Fall through to download
    }
  }

  // Fallback: direct download
  doc.save(fileName);
  return { success: true, method: 'download' };
}
