import { buildHistogram, findPeaks, smoothHistogram } from './utils/histogram.js';

const BIN_SIZE = 0.05;
const DOT_THRESHOLD_SQ = 0.85 * 0.85;

/**
 * Detects the single primary floor level in the 3D model.
 * Returns the lowest significant horizontal surface as the floor.
 *
 * @param {Array} meshes - Array of meshes.
 * @param {string} upAxis - The detected up axis ('+y', '-y', '+z', etc.).
 * @param {{ sliceOffset?: number }} [options] - Optional slice offset above floor in meters.
 * @returns {{ name: string, floorHeight: number, ceilingHeight: number, sliceHeight: number } | null}
 */
export function detectFloor(meshes, upAxis, options = {}) {
  if (!meshes || meshes.length === 0 || !upAxis) {
    return null;
  }

  const sliceOffset = typeof options.sliceOffset === 'number' && options.sliceOffset > 0
    ? options.sliceOffset
    : 1.0;

  const axisDim = upAxis[1]; // 'x', 'y', or 'z'
  const sign = upAxis[0] === '-' ? -1 : 1;
  const axisIdx = axisDim === 'x' ? 0 : axisDim === 'y' ? 1 : 2;

  const signedHeights = [];

  for (let m = 0; m < meshes.length; m++) {
    const { positions, indices } = meshes[m];
    if (!positions) continue;

    const numTriangles = indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
    for (let i = 0; i < numTriangles; i++) {
      let i0, i1, i2;
      if (indices) {
        const base = i * 3;
        i0 = indices[base] * 3;
        i1 = indices[base + 1] * 3;
        i2 = indices[base + 2] * 3;
      } else {
        i0 = i * 9;
        i1 = i0 + 3;
        i2 = i0 + 6;
      }

      const v0x = positions[i0];
      const v0y = positions[i0 + 1];
      const v0z = positions[i0 + 2];

      const e1x = positions[i1] - v0x;
      const e1y = positions[i1 + 1] - v0y;
      const e1z = positions[i1 + 2] - v0z;

      const e2x = positions[i2] - v0x;
      const e2y = positions[i2 + 1] - v0y;
      const e2z = positions[i2 + 2] - v0z;

      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;

      const lenSq = nx * nx + ny * ny + nz * nz;
      if (lenSq === 0) continue;

      const normalComp = axisIdx === 0 ? nx : axisIdx === 1 ? ny : nz;
      const upComp = normalComp * sign;

      if (upComp > 0 && upComp * upComp > DOT_THRESHOLD_SQ * lenSq) {
        const centroidAxis = (positions[i0 + axisIdx] + positions[i1 + axisIdx] + positions[i2 + axisIdx]) / 3;
        signedHeights.push(centroidAxis * sign);
      }
    }
  }

  if (signedHeights.length === 0) return null;

  const hist = buildHistogram(signedHeights, BIN_SIZE);
  const smoothedHist = smoothHistogram(hist, 2, BIN_SIZE);
  const peaks = findPeaks(smoothedHist, Math.max(3, signedHeights.length * 0.003), 0.3);

  if (!peaks || peaks.length === 0) {
    // Use lowest height along the signed up-axis so negative up-axes compute the true floor
    let minSigned = signedHeights[0];
    for (let i = 1; i < signedHeights.length; i++) {
      if (signedHeights[i] < minSigned) minSigned = signedHeights[i];
    }
    const floorRaw = minSigned * sign;
    return {
      name: 'Floor 1',
      floorHeight: floorRaw,
      ceilingHeight: floorRaw + sign * 3.0,
      sliceHeight: floorRaw + sign * sliceOffset,
    };
  }

  peaks.sort((a, b) => a.value - b.value);

  const floorPeak = peaks[0];
  const floorRaw = floorPeak.value * sign;

  // Try to find a ceiling peak 2.0-4.5m above the floor
  let ceilingRaw = floorRaw + sign * 3.0;
  for (let j = 1; j < peaks.length; j++) {
    const diff = peaks[j].value - floorPeak.value;
    if (diff >= 2.0 && diff <= 4.5) {
      ceilingRaw = peaks[j].value * sign;
      break;
    }
  }

  return {
    name: 'Floor 1',
    floorHeight: floorRaw,
    ceilingHeight: ceilingRaw,
    sliceHeight: floorRaw + sign * sliceOffset,
  };
}
