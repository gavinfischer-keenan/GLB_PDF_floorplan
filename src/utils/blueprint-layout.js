/**
 * Pure blueprint layout, paper size, scale ratio, and scale-bar math helpers.
 * Zero external dependencies so Step 4 preview does not pull jsPDF into the initial bundle.
 */

/** Paper sizes in mm (base landscape) */
export const PAPER_SIZES = {
  a4: { width: 297, height: 210 },        // Landscape A4
  a3: { width: 420, height: 297 },        // Landscape A3
  letter: { width: 279.4, height: 215.9 }, // Landscape Letter
  tabloid: { width: 431.8, height: 279.4 }, // Landscape Tabloid
};

/**
 * Returns paper dimensions in mm for landscape or portrait orientation.
 * @param {string} [paperSize='a3']
 * @param {'landscape'|'portrait'} [orientation='landscape']
 * @returns {{ width: number, height: number }}
 */
export function getPaperDimensions(paperSize = 'a3', orientation = 'landscape') {
  const base = PAPER_SIZES[paperSize] || PAPER_SIZES.a3;
  if (orientation === 'portrait') {
    return { width: base.height, height: base.width };
  }
  return { width: base.width, height: base.height };
}

/**
 * Formats scale ratio with US Imperial architectural equivalents when applicable.
 * @param {number} scale
 * @param {'imperial'|'metric'} [units='imperial']
 * @returns {string}
 */
export function formatScaleLabel(scale, units = 'imperial') {
  if (scale === 24) return units === 'imperial' ? '1/2" = 1\'-0" (1:24)' : '1:24';
  if (scale === 48) return units === 'imperial' ? '1/4" = 1\'-0" (1:48)' : '1:48';
  if (scale === 96) return units === 'imperial' ? '1/8" = 1\'-0" (1:96)' : '1:96';
  return `1:${scale}`;
}

/**
 * Compute layout scale denominator for a floor bounds on a given paper size.
 * Shared between PDF export and live SVG blueprint preview.
 */
export function computeBlueprintScale(bounds, paper, margin, requestedScale = 'auto', units = 'metric') {
  const drawWidth = Math.max(20, paper.width - margin.left - margin.right);
  const drawHeight = Math.max(20, paper.height - margin.top - margin.bottom);
  const dataWidth = Math.max(0.1, bounds.maxX - bounds.minX);
  const dataHeight = Math.max(0.1, bounds.maxY - bounds.minY);

  let scale;
  if (requestedScale === 'auto') {
    const scaleX = drawWidth / (dataWidth * 1000);
    const scaleY = drawHeight / (dataHeight * 1000);
    const fitScale = Math.min(scaleX, scaleY) * 0.85;
    const denom = 1 / fitScale;
    const niceScales = units === 'imperial'
      ? [12, 24, 48, 96, 120, 192, 240, 480]
      : [10, 20, 25, 50, 75, 100, 150, 200, 250, 500];
    scale = niceScales.find((s) => s >= denom) || Math.ceil(denom / 50) * 50;
  } else {
    scale = Number(requestedScale) || 100;
  }

  return { scale, drawWidth, drawHeight, dataWidth, dataHeight };
}

/**
 * Calculate a nice round length for the scale bar (in meters).
 * Kept for backwards compatibility; prefer computeScaleBar for exact unit-aware bars.
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
 * Computes an exact unit-accurate scale bar whose physical width matches the drawing scale.
 * @param {number} scale - Scale denominator (e.g. 50 for 1:50)
 * @param {'imperial'|'metric'} [units='imperial']
 * @param {number} [maxMm=55] - Maximum bar width in millimeters
 * @returns {{ meters: number, widthMm: number, label: string }}
 */
export function computeScaleBar(scale, units = 'imperial', maxMm = 55) {
  const safeScale = scale > 0 ? scale : 100;
  const mmPerMeter = 1000 / safeScale;

  if (units === 'metric') {
    const candidates = [0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 50, 100];
    let chosen = candidates[0];
    for (const v of candidates) {
      if (v * mmPerMeter <= maxMm) {
        chosen = v;
      }
    }
    const label = chosen < 1 ? `${Math.round(chosen * 100)} cm` : `${chosen} m`;
    return { meters: chosen, widthMm: chosen * mmPerMeter, label };
  }

  const METERS_PER_FOOT = 0.3048;
  const footCandidates = [1, 2, 4, 5, 10, 15, 20, 25, 50, 100, 200];
  let chosenFeet = footCandidates[0];
  for (const ft of footCandidates) {
    if (ft * METERS_PER_FOOT * mmPerMeter <= maxMm) {
      chosenFeet = ft;
    }
  }
  const meters = chosenFeet * METERS_PER_FOOT;
  return {
    meters,
    widthMm: meters * mmPerMeter,
    label: `${chosenFeet} ft`,
  };
}
